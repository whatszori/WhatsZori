// Package notify decides when an incoming message becomes a desktop notification and what it
// says. Sending is behind a function, so all of it is testable without Windows.
package notify

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Settings is the "notifications" part of AppSettings.
type Settings struct {
	Enabled bool
	// show who wrote and what; off = just "New message"
	Preview bool
	Sound   bool
}

// Toast is one notification to show.
type Toast struct {
	ID    string
	Chat  string // empty for summaries
	PK    string
	Title string
	Body  string
	// absolute path of a cached avatar, or ""
	Avatar string
	Silent bool
	// reply field and "Mark as read"
	Actions bool
	// the chat is a group (WhatsZori's own toasts show a group icon)
	Group bool
}

type Options struct {
	Send     func(Toast) error
	Settings func() Settings
	// Focused reports whether the app window has focus
	Focused func() bool
	// Avatar returns a cached picture for jid without fetching anything
	Avatar func(jid string) string
	// Withdraw takes a chat's notification down (the chat was opened or read)
	Withdraw func(chat string)
	// After schedules f; tests replace it to run timers by hand
	After func(d time.Duration, f func())
	Now   func() time.Time
}

const (
	// messages in one chat that arrive this close together become one notification
	batchWindow = 1500 * time.Millisecond
	// at most this many notifications per rateWindow; the rest are summed up
	rateLimit  = 5
	rateWindow = 10 * time.Second
	// if the server never says the offline backlog is done, stop waiting
	offlineTimeout = 90 * time.Second
	bodyMax        = 180
)

type batch struct {
	chat  domain.Chat
	last  domain.Message
	count int
}

type Center struct {
	o Options

	mu                sync.Mutex
	active            string
	pending           map[string]*batch
	sent              []time.Time
	overflow          int
	overflowScheduled bool
	offline           bool
	offlineN          int
	offlineChats      map[string]bool
	offlineGen        int
	seq               int
	// messages per chat since it was last opened, for "Alan (5 new)"
	unseen map[string]int
}

func New(o Options) *Center {
	if o.After == nil {
		o.After = func(d time.Duration, f func()) { time.AfterFunc(d, f) }
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Focused == nil {
		o.Focused = func() bool { return false }
	}
	if o.Avatar == nil {
		o.Avatar = func(string) string { return "" }
	}
	if o.Withdraw == nil {
		o.Withdraw = func(string) {}
	}
	return &Center{o: o, pending: map[string]*batch{}, offlineChats: map[string]bool{}, unseen: map[string]int{}}
}

// SetActive is the chat open in the window ("" for none).
func (c *Center) SetActive(jid string) {
	c.mu.Lock()
	c.active = jid
	c.mu.Unlock()
	if jid != "" {
		c.Seen(jid)
	}
}

// Seen resets a chat's count and takes its notification down.
func (c *Center) Seen(jid string) {
	c.mu.Lock()
	delete(c.unseen, jid)
	c.mu.Unlock()
	c.o.Withdraw(jid)
}

func (c *Center) looking(chat string) bool {
	c.mu.Lock()
	active := c.active
	c.mu.Unlock()
	return chat == active && c.o.Focused()
}

// Incoming is a new live message. History sync and our own messages never get here.
func (c *Center) Incoming(m domain.Message, chat domain.Chat) {
	s := c.o.Settings()
	if !s.Enabled || m.FromMe || chat.Muted || m.Deleted != nil {
		return
	}
	if c.looking(chat.JID) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.offline {
		c.offlineN++
		c.offlineChats[chat.JID] = true
		return
	}
	b := c.pending[chat.JID]
	if b == nil {
		b = &batch{}
		c.pending[chat.JID] = b
		jid := chat.JID
		c.o.After(batchWindow, func() { c.flush(jid) })
	}
	b.chat, b.last = chat, m
	b.count++
	c.unseen[chat.JID]++
}

func (c *Center) flush(jid string) {
	c.mu.Lock()
	b := c.pending[jid]
	delete(c.pending, jid)
	c.mu.Unlock()
	if b == nil || c.looking(jid) {
		return
	}
	if !c.take(b.count) {
		return
	}
	c.send(c.messageToast(b))
}

// take reserves a slot under the rate limit; without one, the messages go into a summary.
func (c *Center) take(count int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.o.Now()
	keep := c.sent[:0]
	for _, t := range c.sent {
		if now.Sub(t) < rateWindow {
			keep = append(keep, t)
		}
	}
	c.sent = keep
	if len(c.sent) < rateLimit {
		c.sent = append(c.sent, now)
		return true
	}
	c.overflow += count
	if !c.overflowScheduled {
		c.overflowScheduled = true
		c.o.After(rateWindow, c.flushOverflow)
	}
	return false
}

func (c *Center) flushOverflow() {
	c.mu.Lock()
	n := c.overflow
	c.overflow, c.overflowScheduled = 0, false
	c.mu.Unlock()
	if n == 0 || c.o.Focused() {
		return
	}
	c.send(c.summary(fmt.Sprintf("%d more %s", n, plural(n, "message", "messages")), ""))
}

// OfflineStart: the server is about to replay what arrived while we were offline. Those messages
// are counted, not shown one by one.
func (c *Center) OfflineStart() {
	c.mu.Lock()
	c.offline = true
	c.offlineGen++
	gen := c.offlineGen
	c.mu.Unlock()
	c.o.After(offlineTimeout, func() {
		c.mu.Lock()
		stale := c.offline && c.offlineGen == gen
		c.mu.Unlock()
		if stale {
			c.OfflineDone()
		}
	})
}

func (c *Center) OfflineDone() {
	c.mu.Lock()
	if !c.offline {
		c.mu.Unlock()
		return
	}
	n, chats := c.offlineN, len(c.offlineChats)
	c.offline, c.offlineN = false, 0
	c.offlineChats = map[string]bool{}
	c.mu.Unlock()
	s := c.o.Settings()
	if n == 0 || !s.Enabled || c.o.Focused() {
		return
	}
	body := fmt.Sprintf("%d new %s", n, plural(n, "message", "messages"))
	if chats > 1 {
		body += fmt.Sprintf(" in %d chats", chats)
	}
	c.send(c.summary(body, ""))
}

// Info shows a plain note from the app.
func (c *Center) Info(text string) {
	c.send(c.summary(text, ""))
}

// Error tells the user something failed while the window may be in the background (a reply
// from a notification that couldn't be sent).
func (c *Center) Error(text string) {
	c.send(c.summary(text, ""))
}

func (c *Center) nextID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seq++
	return fmt.Sprintf("wz-%d-%d", c.o.Now().UnixMilli(), c.seq)
}

func (c *Center) send(t Toast) {
	if c.o.Send != nil {
		_ = c.o.Send(t)
	}
}

func (c *Center) summary(body, chat string) Toast {
	s := c.o.Settings()
	return Toast{ID: c.nextID(), Chat: chat, Title: "WhatsZori", Body: body, Silent: !s.Sound}
}

func (c *Center) messageToast(b *batch) Toast {
	s := c.o.Settings()
	t := Toast{ID: c.nextID(), Chat: b.chat.JID, PK: b.last.PK, Silent: !s.Sound, Actions: true, Group: b.chat.IsGroup}
	if !s.Preview {
		// nothing about who or what: someone looking at the screen learns only that something came
		t.Title = "WhatsZori"
		t.Body = "New message"
		if b.count > 1 {
			t.Body = fmt.Sprintf("%d new messages", b.count)
		}
		return t
	}
	c.mu.Lock()
	n := max(c.unseen[b.chat.JID], b.count)
	c.mu.Unlock()
	t.Title = b.chat.Name
	if n > 1 {
		t.Title = fmt.Sprintf("%s (%d new)", b.chat.Name, n)
	}
	body := Preview(b.last)
	if b.chat.IsGroup {
		body = b.last.SenderName + ": " + body
	}
	t.Body = clip(body, bodyMax)
	t.Avatar = c.o.Avatar(b.chat.JID)
	return t
}

// Preview is the one-line description of a message for notifications.
func Preview(m domain.Message) string {
	caption := strings.TrimSpace(domain.PlainText(domain.MentionNames(m.Text, m.Mentions)))
	with := func(label string) string {
		if caption != "" {
			return label + " · " + caption
		}
		return label
	}
	if m.ContentUnknown {
		return "Message"
	}
	switch m.Kind {
	case domain.KindContact:
		if len(m.Contacts) == 1 {
			return "👤 " + m.Contacts[0].Name
		}
		if len(m.Contacts) > 1 {
			return fmt.Sprintf("👤 %d contacts", len(m.Contacts))
		}
		return "👤 Contact"
	case domain.KindEvent:
		if m.Event != nil {
			return "📅 " + m.Event.Name
		}
		return "📅 Event"
	case domain.KindLocation:
		if m.Location != nil && m.Location.Live {
			return with("📍 Live location")
		}
		if m.Location != nil && m.Location.Name != "" {
			return with("📍 " + m.Location.Name)
		}
		return with("📍 Location")
	case domain.KindImage:
		return with("📷 Photo")
	case domain.KindVideo:
		switch {
		case m.Media != nil && m.Media.Round:
			return "📹 Video message" + duration(m.Media)
		case m.Media != nil && m.Media.Gif:
			return with("GIF")
		}
		return with("🎥 Video")
	case domain.KindVoice:
		return "🎤 Voice message" + duration(m.Media)
	case domain.KindDocument:
		name := "Document"
		if m.Media != nil && m.Media.FileName != "" {
			name = m.Media.FileName
		}
		return with("📄 " + name)
	case domain.KindSticker:
		return "Sticker"
	}
	if caption == "" {
		return "Message"
	}
	return caption
}

func duration(m *domain.MediaInfo) string {
	if m == nil || m.Duration <= 0 {
		return ""
	}
	return fmt.Sprintf(" (%d:%02d)", m.Duration/60, m.Duration%60)
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
