package app

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io/fs"
	"log/slog"
	"strconv"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	xdraw "golang.org/x/image/draw"
)

// tray is the notification-area icon plus the unread count on the taskbar button.
type tray struct {
	a    *App
	t    *application.SystemTray
	dock *dock.DockService
	// Linux docks (KDE, Dash to Dock) read the count from a D-Bus signal instead
	launcher *launcherEntry

	plain, dotted []byte

	mu     sync.Mutex
	unread int
}

const trayIconSize = 32

func newTray(a *App) *tray {
	return &tray{a: a, dock: dock.New(), launcher: newLauncherEntry("WhatsZori.desktop")}
}

// setup builds the icon from the logo in the embedded frontend and adds the tray menu.
func (t *tray) setup(frontend fs.FS) {
	data, err := fs.ReadFile(frontend, "logo-192.png")
	if err != nil {
		slog.Warn("tray icon", "error", err)
		return
	}
	base, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		slog.Warn("tray icon", "error", err)
		return
	}
	t.plain = encodeIcon(base, false)
	t.dotted = encodeIcon(base, true)

	menu := application.NewMenu()
	menu.Add("Open WhatsZori").OnClick(func(*application.Context) { t.a.focus() })
	menu.AddSeparator()
	menu.Add("Quit WhatsZori").OnClick(func(*application.Context) { t.a.quit() })

	t.t = t.a.wails.SystemTray.New()
	t.t.SetIcon(t.plain)
	t.t.SetTooltip(title)
	t.t.SetMenu(menu)
	t.t.OnClick(func() { t.a.focus() })
}

func (t *tray) available() bool { return t.t != nil }

// setUnread is the number of chats with unread messages (muted and archived ones don't count,
// like the rail badge and the official client).
func (t *tray) setUnread(n int) {
	t.mu.Lock()
	changed := n != t.unread
	t.unread = n
	t.mu.Unlock()
	if !changed {
		return
	}
	if t.t != nil {
		if n > 0 {
			t.t.SetIcon(t.dotted)
			t.t.SetTooltip(fmt.Sprintf("%s · %d unread %s", title, n, plural(n, "chat", "chats")))
		} else {
			t.t.SetIcon(t.plain)
			t.t.SetTooltip(title)
		}
	}
	if n > 0 {
		label := strconv.Itoa(n)
		if n > 99 {
			label = "99+"
		}
		_ = t.dock.SetBadge(label)
	} else {
		_ = t.dock.RemoveBadge()
	}
	t.launcher.set(n)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// encodeIcon scales the logo to tray size, with a red dot in the corner for "unread".
func encodeIcon(src image.Image, dot bool) []byte {
	dst := image.NewNRGBA(image.Rect(0, 0, trayIconSize, trayIconSize))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	if dot {
		// ring in the background colour first, so the dot reads on any taskbar
		drawDisc(dst, 24, 24, 8, color.NRGBA{255, 255, 255, 255})
		drawDisc(dst, 24, 24, 6, color.NRGBA{0xd9, 0x3f, 0x3f, 255})
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, dst)
	return buf.Bytes()
}

func drawDisc(img *image.NRGBA, cx, cy, r int, c color.NRGBA) {
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			dx, dy := x-cx, y-cy
			if dx*dx+dy*dy <= r*r && image.Pt(x, y).In(img.Bounds()) {
				img.SetNRGBA(x, y, c)
			}
		}
	}
}
