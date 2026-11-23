package clip

import (
	"encoding/binary"
	"fmt"
	"runtime"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32           = windows.NewLazySystemDLL("user32.dll")
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	openClipboard    = user32.NewProc("OpenClipboard")
	closeClipboard   = user32.NewProc("CloseClipboard")
	emptyClipboard   = user32.NewProc("EmptyClipboard")
	setClipboardData = user32.NewProc("SetClipboardData")
	registerFormat   = user32.NewProc("RegisterClipboardFormatW")
	globalAlloc      = kernel32.NewProc("GlobalAlloc")
	globalLock       = kernel32.NewProc("GlobalLock")
	globalUnlock     = kernel32.NewProc("GlobalUnlock")
	globalFree       = kernel32.NewProc("GlobalFree")
	moveMemory       = kernel32.NewProc("RtlMoveMemory")
)

const (
	cfDIB          = 8
	cfHDROP        = 15
	gmemMoveable   = 0x0002
	dropEffectCopy = 1
)

func copyFile(path string, pic *Picture) error {
	// the clipboard belongs to the thread that opened it
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// another app may be holding it for a moment
	var opened bool
	for range 10 {
		if r, _, _ := openClipboard.Call(0); r != 0 {
			opened = true
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if !opened {
		return fmt.Errorf("the clipboard is busy, try again")
	}
	defer closeClipboard.Call()
	if r, _, err := emptyClipboard.Call(); r == 0 {
		return fmt.Errorf("empty clipboard: %w", err)
	}
	if err := set(cfHDROP, DropFiles([]string{path})); err != nil {
		return err
	}
	// Explorer pastes a copy, not a move
	effect := make([]byte, 4)
	binary.LittleEndian.PutUint32(effect, dropEffectCopy)
	if f, err := format("Preferred DropEffect"); err == nil {
		_ = set(f, effect)
	}
	if pic != nil {
		if err := set(cfDIB, pic.DIB); err != nil {
			return err
		}
		if f, err := format("PNG"); err == nil {
			_ = set(f, pic.PNG)
		}
	}
	return nil
}

func format(name string) (uintptr, error) {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	f, _, err := registerFormat.Call(uintptr(unsafe.Pointer(p)))
	if f == 0 {
		return 0, err
	}
	return f, nil
}

// set copies data into global memory and hands it to the clipboard, which owns it afterwards.
func set(f uintptr, data []byte) error {
	h, _, err := globalAlloc.Call(gmemMoveable, uintptr(len(data)))
	if h == 0 {
		return fmt.Errorf("alloc: %w", err)
	}
	p, _, err := globalLock.Call(h)
	if p == 0 {
		globalFree.Call(h)
		return fmt.Errorf("lock: %w", err)
	}
	if len(data) > 0 {
		moveMemory.Call(p, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	}
	globalUnlock.Call(h)
	if r, _, err := setClipboardData.Call(f, h); r == 0 {
		globalFree.Call(h)
		return fmt.Errorf("set clipboard data: %w", err)
	}
	return nil
}
