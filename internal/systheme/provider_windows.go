//go:build windows

package systheme

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	dwmKey         = `Software\Microsoft\Windows\DWM`
	personalizeKey = `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
)

type windowsProvider struct{}

func New() Provider { return windowsProvider{} }

func (windowsProvider) Read() SystemPalette {
	p := SystemPalette{Source: "windows", Raw: map[string]string{}}

	if k, err := registry.OpenKey(registry.CURRENT_USER, dwmKey, registry.QUERY_VALUE); err == nil {
		if v, _, err := k.GetIntegerValue("AccentColor"); err == nil {
			p.Accent = ABGRToHex(uint32(v))
			p.Raw["AccentColor"] = fmt.Sprintf("0x%08x", uint32(v))
		}
		if v, _, err := k.GetIntegerValue("ColorizationColor"); err == nil {
			p.Raw["ColorizationColor"] = fmt.Sprintf("0x%08x", uint32(v))
		}
		k.Close()
	}

	if k, err := registry.OpenKey(registry.CURRENT_USER, personalizeKey, registry.QUERY_VALUE); err == nil {
		if v, _, err := k.GetIntegerValue("AppsUseLightTheme"); err == nil {
			p.Raw["AppsUseLightTheme"] = fmt.Sprint(v)
			if v == 0 {
				p.Scheme = SchemeDark
			} else {
				p.Scheme = SchemeLight
			}
		}
		if v, _, err := k.GetIntegerValue("SystemUsesLightTheme"); err == nil {
			p.Raw["SystemUsesLightTheme"] = fmt.Sprint(v)
		}
		k.Close()
	}

	return finish(p)
}

// Watch blocks on RegNotifyChangeKeyValue for both keys. Windows fires several notifications per
// change (Settings writes a handful of values), so they're coalesced for a moment before changed().
func (windowsProvider) Watch(ctx context.Context, changed func()) {
	type watched struct {
		key   registry.Key
		event windows.Handle
	}
	var ws []watched
	defer func() {
		for _, w := range ws {
			w.key.Close()
			windows.CloseHandle(w.event)
		}
	}()

	for _, path := range []string{dwmKey, personalizeKey} {
		k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.NOTIFY|registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		ev, err := windows.CreateEvent(nil, 0, 0, nil)
		if err != nil {
			k.Close()
			continue
		}
		ws = append(ws, watched{k, ev})
	}
	if len(ws) == 0 {
		return
	}

	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return
	}
	defer windows.CloseHandle(stop)
	go func() {
		<-ctx.Done()
		windows.SetEvent(stop)
	}()

	const filter = windows.REG_NOTIFY_CHANGE_LAST_SET | windows.REG_NOTIFY_CHANGE_NAME
	arm := func(w watched) error {
		return windows.RegNotifyChangeKeyValue(windows.Handle(w.key), false, filter, w.event, true)
	}
	handles := []windows.Handle{stop}
	for _, w := range ws {
		if err := arm(w); err != nil {
			return
		}
		handles = append(handles, w.event)
	}

	for {
		idx, err := windows.WaitForMultipleObjects(handles, false, windows.INFINITE)
		if err != nil || idx == windows.WAIT_OBJECT_0 {
			return
		}
		i := int(idx-windows.WAIT_OBJECT_0) - 1
		if i < 0 || i >= len(ws) {
			return
		}
		// the notification is one-shot, re-arm before reading so nothing slips through
		if err := arm(ws[i]); err != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(150 * time.Millisecond):
		}
		changed()
	}
}
