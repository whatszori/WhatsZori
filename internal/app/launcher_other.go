//go:build !linux

package app

// Windows and macOS badge through Wails' dock service; nothing extra here.
type launcherEntry struct{}

func newLauncherEntry(string) *launcherEntry { return &launcherEntry{} }
func (*launcherEntry) set(int)               {}
