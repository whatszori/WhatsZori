package notify

import (
	"strings"
	"testing"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
)

type harness struct {
	c       *Center
	sent    []Toast
	timers  []func()
	focused bool
	now     time.Time
	set     Settings
}

func newHarness() *harness {
	h := &harness{now: time.Unix(1_750_000_000, 0), set: Settings{Enabled: true, Preview: true, Sound: true}}
	h.c = New(Options{
		Send:     func(t Toast) error { h.sent = append(h.sent, t); return nil },
		Settings: func() Settings { return h.set },
		Focused:  func() bool { return h.focused },
		Avatar:   func(jid string) string { return `C:\avatars\` + jid + ".jpg" },
		After:    func(_ time.Duration, f func()) { h.timers = append(h.timers, f) },
		Now:      func() time.Time { return h.now },
	})
	return h
}

// run fires every scheduled timer, like time passing
func (h *harness) run() {
	for len(h.timers) > 0 {
		t := h.timers
		h.timers = nil
		for _, f := range t {
			f()
		}
	}
}

var (
	alan  = domain.Chat{JID: "491700000001@s.whatsapp.net", Name: "Alan"}
	group = domain.Chat{JID: "120363@g.us", Name: "Ильнар", IsGroup: true}
)

func text(chat domain.Chat, pk, body string) domain.Message {
	return domain.Message{PK: pk, ChatJID: chat.JID, SenderName: "Bob", Kind: domain.KindText, Text: body}
}

func TestSingleMessage(t *testing.T) {
	h := newHarness()
	h.c.Incoming(text(alan, "1", "hi there"), alan)
	if len(h.sent) != 0 {
		t.Fatal("sent before the batch window closed")
	}
	h.run()
	if len(h.sent) != 1 {
		t.Fatalf("sent %d", len(h.sent))
	}
	n := h.sent[0]
	if n.Title != "Alan" || n.Body != "hi there" || n.Chat != alan.JID || n.PK != "1" || !n.Actions || n.Silent || n.Avatar == "" {
		t.Errorf("toast: %+v", n)
	}
}

func TestBatchAndGroupSender(t *testing.T) {
	h := newHarness()
	h.c.Incoming(text(group, "1", "one"), group)
	h.c.Incoming(text(group, "2", "two"), group)
	h.c.Incoming(text(group, "3", "three"), group)
	h.run()
	if len(h.sent) != 1 {
		t.Fatalf("sent %d, want one batched toast", len(h.sent))
	}
	if n := h.sent[0]; n.Title != "Ильнар (3 new)" || n.Body != "Bob: three" || n.PK != "3" {
		t.Errorf("toast: %+v", n)
	}
}

func TestSkips(t *testing.T) {
	h := newHarness()
	mine := text(alan, "1", "mine")
	mine.FromMe = true
	h.c.Incoming(mine, alan)
	muted := alan
	muted.Muted = true
	h.c.Incoming(text(muted, "2", "muted"), muted)
	// looking at the chat
	h.focused = true
	h.c.SetActive(alan.JID)
	h.c.Incoming(text(alan, "3", "seen"), alan)
	h.set.Enabled = false
	h.c.Incoming(text(group, "4", "off"), group)
	h.run()
	if len(h.sent) != 0 {
		t.Fatalf("sent %+v", h.sent)
	}
}

func TestOtherChatWhileFocused(t *testing.T) {
	h := newHarness()
	h.focused = true
	h.c.SetActive(group.JID)
	h.c.Incoming(text(alan, "1", "hey"), alan)
	h.run()
	if len(h.sent) != 1 {
		t.Fatal("no toast for another chat while the window is focused")
	}
}

func TestOpenedDuringBatchWindow(t *testing.T) {
	h := newHarness()
	h.c.Incoming(text(alan, "1", "hey"), alan)
	h.focused = true
	h.c.SetActive(alan.JID)
	h.run()
	if len(h.sent) != 0 {
		t.Error("toast for a chat the user opened meanwhile")
	}
}

func TestNoPreview(t *testing.T) {
	h := newHarness()
	h.set.Preview = false
	h.set.Sound = false
	h.c.Incoming(text(alan, "1", "secret"), alan)
	h.c.Incoming(text(alan, "2", "secret 2"), alan)
	h.run()
	n := h.sent[0]
	if n.Title != "WhatsZori" || n.Body != "2 new messages" || n.Avatar != "" || !n.Silent || strings.Contains(n.Body+n.Title, "Alan") {
		t.Errorf("preview off leaks: %+v", n)
	}
}

func TestRateLimit(t *testing.T) {
	h := newHarness()
	for i := range 8 {
		c := domain.Chat{JID: string(rune('a'+i)) + "@s.whatsapp.net", Name: "C"}
		h.c.Incoming(text(c, "1", "x"), c)
	}
	h.run()
	if len(h.sent) != 6 {
		t.Fatalf("sent %d, want 5 + 1 summary", len(h.sent))
	}
	if last := h.sent[5]; last.Body != "3 more messages" || last.Chat != "" {
		t.Errorf("summary: %+v", last)
	}
}

func TestOfflineBacklog(t *testing.T) {
	h := newHarness()
	h.c.OfflineStart()
	for i := range 40 {
		c := alan
		if i%2 == 0 {
			c = group
		}
		h.c.Incoming(text(c, "1", "old"), c)
	}
	h.c.OfflineDone()
	if len(h.sent) != 1 || h.sent[0].Body != "40 new messages in 2 chats" {
		t.Fatalf("offline summary: %+v", h.sent)
	}
	// and live again afterwards
	h.c.Incoming(text(alan, "2", "new"), alan)
	h.timers = h.timers[len(h.timers)-1:] // skip the offline safety timer
	h.run()
	if len(h.sent) != 2 || h.sent[1].Body != "new" {
		t.Errorf("after backlog: %+v", h.sent)
	}
}

func TestPreviewText(t *testing.T) {
	cases := []struct {
		m    domain.Message
		want string
	}{
		{domain.Message{Kind: domain.KindImage, Text: "look"}, "📷 Photo · look"},
		{domain.Message{Kind: domain.KindVoice, Media: &domain.MediaInfo{Duration: 66}}, "🎤 Voice message (1:06)"},
		{domain.Message{Kind: domain.KindVideo, Media: &domain.MediaInfo{Round: true, Duration: 9}}, "📹 Video message (0:09)"},
		{domain.Message{Kind: domain.KindVideo, Media: &domain.MediaInfo{Gif: true}}, "GIF"},
		{domain.Message{Kind: domain.KindDocument, Media: &domain.MediaInfo{FileName: "a.pdf"}}, "📄 a.pdf"},
		{domain.Message{Kind: domain.KindSticker}, "Sticker"},
		{domain.Message{Kind: domain.KindText, Text: "📍 Home"}, "📍 Home"},
	}
	for _, c := range cases {
		if got := Preview(c.m); got != c.want {
			t.Errorf("Preview(%+v) = %q, want %q", c.m, got, c.want)
		}
	}
	if got := clip(strings.Repeat("a", 300), 10); len([]rune(got)) != 10 {
		t.Errorf("clip: %q", got)
	}
}

func TestUnseenAcrossBatches(t *testing.T) {
	h := newHarness()
	var withdrawn []string
	h.c.o.Withdraw = func(c string) { withdrawn = append(withdrawn, c) }
	h.c.Incoming(text(alan, "1", "one"), alan)
	h.run()
	h.c.Incoming(text(alan, "2", "two"), alan)
	h.run()
	if h.sent[1].Title != "Alan (2 new)" {
		t.Errorf("second toast title %q", h.sent[1].Title)
	}
	h.c.SetActive(alan.JID)
	h.c.SetActive("")
	h.c.Incoming(text(alan, "3", "three"), alan)
	h.run()
	if h.sent[2].Title != "Alan" || len(withdrawn) != 1 || withdrawn[0] != alan.JID {
		t.Errorf("after opening: title %q, withdrawn %v", h.sent[2].Title, withdrawn)
	}
}
