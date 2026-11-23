package app

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

const customToastsSupported = true

var (
	user32           = windows.NewLazySystemDLL("user32.dll")
	winmm            = windows.NewLazySystemDLL("winmm.dll")
	getWindowLongPtr = user32.NewProc("GetWindowLongPtrW")
	setWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	showWindow       = user32.NewProc("ShowWindow")
	setWindowPos     = user32.NewProc("SetWindowPos")
	setForeground    = user32.NewProc("SetForegroundWindow")
	playSound        = winmm.NewProc("PlaySoundW")
)

const (
	gwlExStyle       = ^uintptr(19) // -20
	wsExNoActivate   = 0x08000000
	wsExToolWindow   = 0x00000080
	swHide           = 0
	swShowNoActivate = 4
	swpNoSize        = 0x0001
	swpNoMove        = 0x0002
	swpNoActivate    = 0x0010
	swpShowWindow    = 0x0040
	hwndTopmost      = ^uintptr(0) // -1
	sndAsync         = 0x0001
	sndNoDefault     = 0x0002
	sndAlias         = 0x00010000
)

func hwndOf(w *application.WebviewWindow) uintptr {
	return uintptr(w.NativeWindow())
}

func setExStyle(hwnd uintptr, set, clear uintptr) {
	cur, _, _ := getWindowLongPtr.Call(hwnd, gwlExStyle)
	setWindowLongPtr.Call(hwnd, gwlExStyle, (cur|set)&^clear)
}

// primeToastWindow runs once at startup, before the main window shows: Wails' Show() activates
// the window even with no-activate set, and it's also what makes the webview inside visible. So
// it happens off-screen while the app is starting anyway, and every real show after this is a
// plain ShowWindow(SW_SHOWNOACTIVATE) that leaves focus where it is.
func primeToastWindow(w *application.WebviewWindow) {
	hwnd := hwndOf(w)
	// tool window: no taskbar button, not in Alt+Tab; no-activate: clicks don't steal focus
	setExStyle(hwnd, wsExNoActivate|wsExToolWindow, 0)
	w.SetPosition(-32000, -32000)
	w.Show()
	showWindow.Call(hwnd, swHide)
}

func showToastWindow(w *application.WebviewWindow, _ bool) {
	hwnd := hwndOf(w)
	setExStyle(hwnd, wsExNoActivate|wsExToolWindow, 0)
	showWindow.Call(hwnd, swShowNoActivate)
	setWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate|swpShowWindow)
}

func hideToastWindow(w *application.WebviewWindow) {
	showWindow.Call(hwndOf(w), swHide)
}

// activateToastWindow drops no-activate so the reply field can get keyboard focus. Windows allows
// SetForegroundWindow here because the user just clicked into this window.
func activateToastWindow(w *application.WebviewWindow) {
	hwnd := hwndOf(w)
	setExStyle(hwnd, 0, wsExNoActivate)
	setForeground.Call(hwnd)
	w.Focus()
}

func deactivateToastWindow(w *application.WebviewWindow) {
	setExStyle(hwndOf(w), wsExNoActivate, 0)
}

// playNotificationSound plays the user's own sound scheme entry for instant messages, so it
// sounds like (and is muted like) every other notification on the machine.
func playNotificationSound() {
	for _, alias := range []string{"Notification.IM", "Notification.Default"} {
		p, err := windows.UTF16PtrFromString(alias)
		if err != nil {
			continue
		}
		if r, _, _ := playSound.Call(uintptr(unsafe.Pointer(p)), 0, sndAlias|sndAsync|sndNoDefault); r != 0 {
			return
		}
	}
}
