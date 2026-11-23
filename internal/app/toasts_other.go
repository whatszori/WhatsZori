//go:build !windows

package app

import "github.com/wailsapp/wails/v3/pkg/application"

// Elsewhere the system's notifications are used: on Wayland a window can't even choose its own
// position, so a corner popup isn't possible there.
const customToastsSupported = false

func showToastWindow(w *application.WebviewWindow, first bool) {
	if first {
		w.Show()
	}
}
func primeToastWindow(*application.WebviewWindow)      {}
func hideToastWindow(w *application.WebviewWindow)     { w.Hide() }
func activateToastWindow(w *application.WebviewWindow) { w.Focus() }
func deactivateToastWindow(*application.WebviewWindow) {}
func playNotificationSound()                           {}
