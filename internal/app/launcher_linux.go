package app

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/godbus/dbus/v5"
)

// launcherEntry publishes the unread count the way KDE Plasma's task manager and GNOME's Dash to
// Dock read it: the com.canonical.Unity.LauncherEntry "Update" signal, keyed by .desktop file.
type launcherEntry struct {
	appURI string
	once   sync.Once
	conn   *dbus.Conn
}

func newLauncherEntry(desktopFile string) *launcherEntry {
	return &launcherEntry{appURI: "application://" + desktopFile}
}

func (l *launcherEntry) bus() *dbus.Conn {
	l.once.Do(func() {
		// only dial a bus that exists, godbus would otherwise try to autolaunch one
		if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
			rt := os.Getenv("XDG_RUNTIME_DIR")
			if _, err := os.Stat(filepath.Join(rt, "bus")); rt == "" || err != nil {
				return
			}
		}
		if c, err := dbus.ConnectSessionBus(); err == nil {
			l.conn = c
		}
	})
	return l.conn
}

func (l *launcherEntry) set(n int) {
	c := l.bus()
	if c == nil {
		return
	}
	_ = c.Emit("/com/whatszori/LauncherEntry", "com.canonical.Unity.LauncherEntry.Update", l.appURI,
		map[string]dbus.Variant{
			"count":         dbus.MakeVariant(int64(n)),
			"count-visible": dbus.MakeVariant(n > 0),
		})
}
