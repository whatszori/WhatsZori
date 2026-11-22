//go:build windows

package app

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// Wails only sets the title bar theme when the window is created, so switching it later
// goes straight to DWM.
func setNativeDark(w *application.WebviewWindow, dark bool) {
	hwnd := uintptr(w.NativeWindow())
	if hwnd == 0 {
		return
	}
	application.InvokeSync(func() { w32.SetTheme(hwnd, dark) })
}
