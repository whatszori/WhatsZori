package notify

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// Freedesktop talks the Desktop Notifications spec (org.freedesktop.Notifications on the session
// bus), which GNOME Shell, KDE Plasma, XFCE, Cinnamon, sway's mako/dunst and the rest implement.
// Servers differ in what they support, so it asks GetCapabilities first and only uses what's
// there: action buttons, body markup, KDE's inline reply.
type Freedesktop struct {
	// DesktopEntry is the .desktop file name without the extension; lets the shell attribute
	// and group our notifications and use the app icon
	DesktopEntry string
	AppName      string
	Icon         string

	mu    sync.Mutex
	conn  *dbus.Conn
	caps  Caps
	byID  map[uint32]shown
	chats map[string]uint32
	fn    func(Response)
}

type shown struct {
	chat string
	pk   string
}

// Caps is what the notification server said it can do.
type Caps struct {
	Actions     bool
	BodyMarkup  bool
	InlineReply bool
	Sound       bool
	Persistence bool
}

const (
	fdDest = "org.freedesktop.Notifications"
	fdPath = "/org/freedesktop/Notifications"
	fdIf   = "org.freedesktop.Notifications"
	// the key KDE (and Phosh) turn into a text field; the answer comes as NotificationReplied
	inlineReplyKey = "inline-reply"
	connectTimeout = 2 * time.Second
	summaryKey     = "\x00summary"
)

func NewFreedesktop(entry, appName, icon string) *Freedesktop {
	return &Freedesktop{DesktopEntry: entry, AppName: appName, Icon: icon, byID: map[uint32]shown{}, chats: map[string]uint32{}}
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

var ErrNoServer = errors.New("no notification server on the session bus")

func (f *Freedesktop) Start(ctx context.Context) error {
	// only dial a bus that exists: godbus would otherwise try to autolaunch one
	if !hasSessionBus() {
		return ErrNoServer
	}
	type res struct {
		c   *dbus.Conn
		err error
	}
	ch := make(chan res, 1)
	go func() {
		c, err := dbus.ConnectSessionBus()
		ch <- res{c, err}
	}()
	var conn *dbus.Conn
	select {
	case r := <-ch:
		if r.err != nil {
			return r.err
		}
		conn = r.c
	case <-time.After(connectTimeout):
		return ErrNoServer
	}

	var caps []string
	cctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := conn.Object(fdDest, fdPath).CallWithContext(cctx, fdIf+".GetCapabilities", 0).Store(&caps); err != nil {
		conn.Close()
		return ErrNoServer
	}
	for _, sig := range []string{"ActionInvoked", "NotificationReplied", "NotificationClosed"} {
		if err := conn.AddMatchSignal(dbus.WithMatchInterface(fdIf), dbus.WithMatchMember(sig)); err != nil {
			conn.Close()
			return err
		}
	}
	signals := make(chan *dbus.Signal, 16)
	conn.Signal(signals)

	f.mu.Lock()
	f.conn = conn
	f.caps = ParseCaps(caps)
	f.mu.Unlock()
	go f.listen(ctx, signals)
	return nil
}

func ParseCaps(list []string) Caps {
	var c Caps
	for _, s := range list {
		switch s {
		case "actions":
			c.Actions = true
		case "body-markup":
			c.BodyMarkup = true
		case "inline-reply":
			c.InlineReply = true
		case "sound":
			c.Sound = true
		case "persistence":
			c.Persistence = true
		}
	}
	return c
}

func (f *Freedesktop) Available() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.conn != nil
}

func (f *Freedesktop) OnResponse(fn func(Response)) {
	f.mu.Lock()
	f.fn = fn
	f.mu.Unlock()
}

// escapeMarkup: servers with body-markup read a small HTML subset, and message text is someone
// else's. Without this "<b>" renders bold and a stray "&" can make the server drop the body.
func escapeMarkup(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// Args is one Notify call, built separately so it can be tested without a bus.
type Args struct {
	Summary string
	Body    string
	Actions []string
	Hints   map[string]dbus.Variant
}

func (f *Freedesktop) BuildArgs(t Toast, caps Caps) Args {
	a := Args{Summary: t.Title, Body: t.Body, Hints: map[string]dbus.Variant{}}
	if caps.BodyMarkup {
		a.Body = escapeMarkup(t.Body)
	}
	if f.DesktopEntry != "" {
		a.Hints["desktop-entry"] = dbus.MakeVariant(f.DesktopEntry)
	}
	a.Hints["category"] = dbus.MakeVariant("im.received")
	a.Hints["urgency"] = dbus.MakeVariant(byte(1))
	if t.Silent {
		a.Hints["suppress-sound"] = dbus.MakeVariant(true)
	} else {
		a.Hints["sound-name"] = dbus.MakeVariant("message-new-instant")
	}
	if t.Avatar != "" {
		a.Hints["image-path"] = dbus.MakeVariant((&url.URL{Scheme: "file", Path: filepath.ToSlash(t.Avatar)}).String())
	}
	if caps.Actions {
		// "default" is a click on the notification itself; servers don't show it as a button
		a.Actions = append(a.Actions, "default", "Open")
		if t.Actions {
			if caps.InlineReply {
				a.Actions = append(a.Actions, inlineReplyKey, "Reply")
				a.Hints["x-kde-reply-placeholder-text"] = dbus.MakeVariant("Reply…")
			} else {
				a.Actions = append(a.Actions, string(ActionReply), "Reply")
			}
			a.Actions = append(a.Actions, string(ActionRead), "Mark as read")
		}
	}
	return a
}

func (f *Freedesktop) Show(t Toast) error {
	f.mu.Lock()
	conn, caps := f.conn, f.caps
	key := t.Chat
	if key == "" {
		key = summaryKey
	}
	// one notification per chat: a new message replaces the previous one instead of stacking
	replaces := f.chats[key]
	f.mu.Unlock()
	if conn == nil {
		return ErrNoServer
	}
	a := f.BuildArgs(t, caps)
	var id uint32
	ctx, cancel := context.WithTimeout(context.Background(), connectTimeout)
	defer cancel()
	err := conn.Object(fdDest, fdPath).CallWithContext(ctx, fdIf+".Notify", 0,
		f.AppName, replaces, f.Icon, a.Summary, a.Body, a.Actions, a.Hints, int32(-1)).Store(&id)
	if err != nil {
		return err
	}
	f.mu.Lock()
	if replaces != 0 && replaces != id {
		delete(f.byID, replaces)
	}
	f.byID[id] = shown{chat: t.Chat, pk: t.PK}
	f.chats[key] = id
	f.mu.Unlock()
	return nil
}

func (f *Freedesktop) Withdraw(chat string) {
	f.mu.Lock()
	id, ok := f.chats[chat]
	conn := f.conn
	if ok {
		delete(f.chats, chat)
		delete(f.byID, id)
	}
	f.mu.Unlock()
	if ok && conn != nil {
		conn.Object(fdDest, fdPath).Call(fdIf+".CloseNotification", 0, id)
	}
}

func (f *Freedesktop) listen(ctx context.Context, signals chan *dbus.Signal) {
	for {
		select {
		case <-ctx.Done():
			return
		case s, ok := <-signals:
			if !ok {
				return
			}
			f.handle(s)
		}
	}
}

func (f *Freedesktop) handle(s *dbus.Signal) {
	if len(s.Body) < 2 {
		return
	}
	id, ok := s.Body[0].(uint32)
	if !ok {
		return
	}
	f.mu.Lock()
	n, known := f.byID[id]
	fn := f.fn
	f.mu.Unlock()
	if !known {
		return
	}
	switch s.Name {
	case fdIf + ".NotificationClosed":
		f.forget(id, n.chat)
		return
	case fdIf + ".NotificationReplied":
		text, _ := s.Body[1].(string)
		f.forget(id, n.chat)
		if fn != nil {
			fn(Response{Chat: n.chat, PK: n.pk, Action: ActionReply, Text: text})
		}
	case fdIf + ".ActionInvoked":
		key, _ := s.Body[1].(string)
		action := ActionOpen
		switch key {
		case string(ActionRead):
			action = ActionRead
		case string(ActionReply):
			action = ActionReply
		case inlineReplyKey:
			// the field was opened; the text arrives with NotificationReplied
			return
		}
		f.forget(id, n.chat)
		if fn != nil {
			fn(Response{Chat: n.chat, PK: n.pk, Action: action})
		}
	}
}

func (f *Freedesktop) forget(id uint32, chat string) {
	f.mu.Lock()
	delete(f.byID, id)
	if f.chats[chat] == id {
		delete(f.chats, chat)
	}
	f.mu.Unlock()
}

func (f *Freedesktop) Close() {
	f.mu.Lock()
	conn := f.conn
	f.conn = nil
	f.mu.Unlock()
	if conn != nil {
		conn.Close()
	}
}
