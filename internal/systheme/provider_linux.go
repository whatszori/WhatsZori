//go:build linux

package systheme

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	portalDest      = "org.freedesktop.portal.Desktop"
	portalPath      = "/org/freedesktop/portal/desktop"
	portalSettings  = "org.freedesktop.portal.Settings"
	appearanceNS    = "org.freedesktop.appearance"
	callTimeout     = 2 * time.Second
	connectTimeout  = 2 * time.Second
	gnomeInterface  = "org.gnome.desktop.interface"
	gsettingsBinary = "gsettings"
)

// GNOME 47+ stores the accent as a name; these are the libadwaita values for each.
var gnomeAccents = map[string]string{
	"blue":   "#3584e4",
	"teal":   "#2190a4",
	"green":  "#3a944a",
	"yellow": "#c88800",
	"orange": "#ed5b00",
	"red":    "#e62d42",
	"pink":   "#d56199",
	"purple": "#9141ac",
	"slate":  "#6f8396",
}

type linuxProvider struct {
	mu    sync.Mutex
	conn  *dbus.Conn
	tried bool
}

func New() Provider { return &linuxProvider{} }

// bus connects lazily and never blocks for long: with no session bus (a bare X session, a
// container, CI) godbus can try to autolaunch one, which we don't want.
func (l *linuxProvider) bus() *dbus.Conn {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.tried {
		return l.conn
	}
	l.tried = true
	if !hasSessionBus() {
		return nil
	}
	type result struct {
		c   *dbus.Conn
		err error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := dbus.ConnectSessionBus()
		ch <- result{c, err}
	}()
	select {
	case r := <-ch:
		if r.err == nil {
			l.conn = r.c
		}
	case <-time.After(connectTimeout):
	}
	return l.conn
}

func hasSessionBus() bool {
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") != "" {
		return true
	}
	if rt := os.Getenv("XDG_RUNTIME_DIR"); rt != "" {
		if _, err := os.Stat(filepath.Join(rt, "bus")); err == nil {
			return true
		}
	}
	return false
}

func (l *linuxProvider) Read() SystemPalette {
	if c := l.bus(); c != nil {
		if p, ok := readPortal(c); ok {
			return finish(p)
		}
	}
	return finish(readGSettings())
}

func readPortal(c *dbus.Conn) (SystemPalette, bool) {
	p := SystemPalette{Source: "xdg-portal", Raw: map[string]string{}}
	obj := c.Object(portalDest, portalPath)

	scheme, err := portalRead(obj, appearanceNS, "color-scheme")
	if err != nil {
		return p, false
	}
	p.Raw["color-scheme"] = fmt.Sprint(scheme.Value())
	p.Scheme = schemeFromPortal(scheme)

	// accent-color is newer than color-scheme, so it's fine for it to be missing
	if accent, err := portalRead(obj, appearanceNS, "accent-color"); err == nil {
		p.Raw["accent-color"] = fmt.Sprint(accent.Value())
		if hex, ok := accentFromPortal(accent); ok {
			p.Accent = hex
		}
	}
	return p, true
}

// ReadOne is portal v2; older portals only have Read, which wraps the value in one more variant.
func portalRead(obj dbus.BusObject, ns, key string) (dbus.Variant, error) {
	ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	var v dbus.Variant
	err := obj.CallWithContext(ctx, portalSettings+".ReadOne", 0, ns, key).Store(&v)
	if err == nil {
		return v, nil
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), callTimeout)
	defer cancel2()
	if err2 := obj.CallWithContext(ctx2, portalSettings+".Read", 0, ns, key).Store(&v); err2 != nil {
		return dbus.Variant{}, err2
	}
	if inner, ok := v.Value().(dbus.Variant); ok {
		return inner, nil
	}
	return v, nil
}

func unwrap(v dbus.Variant) any {
	for {
		inner, ok := v.Value().(dbus.Variant)
		if !ok {
			return v.Value()
		}
		v = inner
	}
}

func schemeFromPortal(v dbus.Variant) string {
	switch n := unwrap(v).(type) {
	case uint32:
		return portalScheme(n)
	case int32:
		return portalScheme(uint32(n))
	}
	return SchemeNone
}

func portalScheme(n uint32) string {
	switch n {
	case 1:
		return SchemeDark
	case 2:
		return SchemeLight
	}
	return SchemeNone
}

func accentFromPortal(v dbus.Variant) (string, bool) {
	switch t := unwrap(v).(type) {
	case []any:
		if len(t) != 3 {
			return "", false
		}
		var c [3]float64
		for i, x := range t {
			f, ok := x.(float64)
			if !ok {
				return "", false
			}
			c[i] = f
		}
		return RGBFloatToHex(c[0], c[1], c[2])
	case []float64:
		if len(t) == 3 {
			return RGBFloatToHex(t[0], t[1], t[2])
		}
	}
	return "", false
}

func readGSettings() SystemPalette {
	p := SystemPalette{Source: "gsettings", Raw: map[string]string{}}
	if _, err := exec.LookPath(gsettingsBinary); err != nil {
		p.Source = "none"
		return p
	}
	if v, ok := gsettingsGet("color-scheme"); ok {
		p.Raw["color-scheme"] = v
		switch v {
		case "prefer-dark":
			p.Scheme = SchemeDark
		case "prefer-light", "default":
			p.Scheme = SchemeLight
		}
	}
	if p.Scheme == "" {
		// pre-42 GNOME only has the GTK theme name
		if v, ok := gsettingsGet("gtk-theme"); ok {
			p.Raw["gtk-theme"] = v
			if strings.HasSuffix(strings.ToLower(v), "-dark") {
				p.Scheme = SchemeDark
			}
		}
	}
	if v, ok := gsettingsGet("accent-color"); ok {
		p.Raw["accent-color"] = v
		p.Accent = gnomeAccents[v]
	}
	return p
}

func gsettingsGet(key string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, gsettingsBinary, "get", gnomeInterface, key).Output()
	if err != nil {
		return "", false
	}
	return strings.Trim(strings.TrimSpace(string(out)), "'"), true
}

// Watch listens for the portal's SettingChanged signal. The gsettings fallback can't be
// watched without spawning `gsettings monitor`, so it doesn't update live.
func (l *linuxProvider) Watch(ctx context.Context, changed func()) {
	c := l.bus()
	if c == nil {
		return
	}
	if err := c.AddMatchSignalContext(ctx,
		dbus.WithMatchObjectPath(portalPath),
		dbus.WithMatchInterface(portalSettings),
		dbus.WithMatchMember("SettingChanged"),
		dbus.WithMatchArg(0, appearanceNS),
	); err != nil {
		return
	}
	signals := make(chan *dbus.Signal, 8)
	c.Signal(signals)
	defer c.RemoveSignal(signals)

	for {
		select {
		case <-ctx.Done():
			return
		case sig, ok := <-signals:
			if !ok {
				return
			}
			if sig.Name != portalSettings+".SettingChanged" || len(sig.Body) < 2 {
				continue
			}
			if ns, _ := sig.Body[0].(string); ns != appearanceNS {
				continue
			}
			changed()
		}
	}
}
