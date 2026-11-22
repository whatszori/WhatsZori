//go:build !windows

package app

import "github.com/wailsapp/wails/v3/pkg/application"

// GTK and macOS draw the title bar from the desktop theme, nothing to do here.
func setNativeDark(*application.WebviewWindow, bool) {}
