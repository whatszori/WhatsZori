package notify

import (
	"slices"
	"testing"

	"github.com/godbus/dbus/v5"
)

func toast() Toast {
	return Toast{Chat: "491700000001@s.whatsapp.net", PK: "7", Title: "Alan <3", Body: `see <b>this</b> & "that"`,
		Avatar: "/home/me/.config/whatszori/avatars/ab cd.jpg", Actions: true}
}

func TestArgsGnomeLike(t *testing.T) {
	f := NewFreedesktop("WhatsZori", "WhatsZori", "WhatsZori")
	// GNOME Shell: actions and body markup, no inline reply
	a := f.BuildArgs(toast(), ParseCaps([]string{"actions", "body", "body-markup", "persistence", "icon-static"}))
	if a.Body != `see &lt;b&gt;this&lt;/b&gt; &amp; "that"` {
		t.Errorf("body not escaped for a markup server: %q", a.Body)
	}
	if a.Summary != "Alan <3" {
		t.Errorf("summary is plain text per spec, got %q", a.Summary)
	}
	if !slices.Equal(a.Actions, []string{"default", "Open", "reply", "Reply", "read", "Mark as read"}) {
		t.Errorf("actions: %v", a.Actions)
	}
	if a.Hints["desktop-entry"].Value() != "WhatsZori" || a.Hints["category"].Value() != "im.received" {
		t.Errorf("hints: %v", a.Hints)
	}
	if got := a.Hints["image-path"].Value(); got != "file:///home/me/.config/whatszori/avatars/ab%20cd.jpg" {
		t.Errorf("image-path: %v", got)
	}
	if _, ok := a.Hints["x-kde-reply-placeholder-text"]; ok {
		t.Error("KDE reply hint on a server without inline reply")
	}
}

func TestArgsKdeLike(t *testing.T) {
	f := NewFreedesktop("WhatsZori", "WhatsZori", "WhatsZori")
	tt := toast()
	tt.Silent = true
	a := f.BuildArgs(tt, ParseCaps([]string{"actions", "body", "body-markup", "inline-reply", "x-kde-urls"}))
	if !slices.Contains(a.Actions, "inline-reply") || slices.Contains(a.Actions, "reply") {
		t.Errorf("KDE should get the inline reply field: %v", a.Actions)
	}
	if a.Hints["suppress-sound"].Value() != true {
		t.Error("silent toast without suppress-sound")
	}
}

func TestArgsMinimalServer(t *testing.T) {
	f := NewFreedesktop("WhatsZori", "WhatsZori", "WhatsZori")
	// e.g. a bare dunst setup: no actions, no markup
	a := f.BuildArgs(toast(), ParseCaps([]string{"body"}))
	if len(a.Actions) != 0 {
		t.Errorf("actions sent to a server without them: %v", a.Actions)
	}
	if a.Body != toast().Body {
		t.Errorf("body escaped for a plain-text server: %q", a.Body)
	}
}

func TestSignals(t *testing.T) {
	f := NewFreedesktop("WhatsZori", "WhatsZori", "WhatsZori")
	var got []Response
	f.OnResponse(func(r Response) { got = append(got, r) })
	f.byID[10] = shown{chat: "a", pk: "1"}
	f.chats["a"] = 10
	f.byID[11] = shown{chat: "b", pk: "2"}
	f.chats["b"] = 11
	f.byID[12] = shown{chat: "c", pk: "3"}

	f.handle(&dbus.Signal{Name: fdIf + ".ActionInvoked", Body: []any{uint32(10), "default"}})
	f.handle(&dbus.Signal{Name: fdIf + ".ActionInvoked", Body: []any{uint32(11), "inline-reply"}})
	f.handle(&dbus.Signal{Name: fdIf + ".NotificationReplied", Body: []any{uint32(11), "on my way"}})
	f.handle(&dbus.Signal{Name: fdIf + ".ActionInvoked", Body: []any{uint32(12), "read"}})
	f.handle(&dbus.Signal{Name: fdIf + ".ActionInvoked", Body: []any{uint32(99), "default"}}) // someone else's

	want := []Response{
		{Chat: "a", PK: "1", Action: ActionOpen},
		{Chat: "b", PK: "2", Action: ActionReply, Text: "on my way"},
		{Chat: "c", PK: "3", Action: ActionRead},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("responses %+v, want %+v", got, want)
	}
	if len(f.byID) != 0 || len(f.chats) != 0 {
		t.Errorf("handled notifications not forgotten: %v %v", f.byID, f.chats)
	}
}
