package antispam

import (
	"errors"
	"strconv"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time      { return c.t }
func (c *clock) add(d time.Duration) { c.t = c.t.Add(d) }
func newLimiter(c *clock) *Limiter   { l := New(DefaultLimits()); l.now = c.now; return l }
func isBlock(err error) bool         { var e *Error; return errors.As(err, &e) }

func TestNormalConversationIsFine(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	// a fast typist: 40 short messages in one chat within a minute, plus a few other chats
	for i := range 40 {
		if err := l.Allow("a", "message "+strconv.Itoa(i)); err != nil {
			t.Fatalf("message %d blocked: %v", i, err)
		}
		c.add(time.Second)
	}
	for _, chat := range []string{"b", "c", "d"} {
		if err := l.Allow(chat, "ok"); err != nil {
			t.Fatalf("short reply to %s blocked: %v", chat, err)
		}
	}
}

func TestShortSameTextIsFine(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	for i := range 8 {
		if err := l.Allow("chat"+strconv.Itoa(i), "thanks!"); err != nil {
			t.Fatalf("'thanks!' to chat %d blocked: %v", i, err)
		}
		c.add(10 * time.Second)
	}
}

func TestMessagesPerMinute(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	for i := range 60 {
		if err := l.Allow("a", strconv.Itoa(i)); err != nil {
			t.Fatalf("message %d: %v", i, err)
		}
	}
	if err := l.Allow("a", "one more"); !isBlock(err) {
		t.Fatalf("61st message in a minute allowed")
	}
	c.add(61 * time.Second)
	if err := l.Allow("a", "later"); err != nil {
		t.Fatalf("still blocked a minute later: %v", err)
	}
}

func TestDistinctChatsPerMinute(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	for i := range 12 {
		if err := l.Allow("chat"+strconv.Itoa(i), "hi "+strconv.Itoa(i)); err != nil {
			t.Fatalf("chat %d: %v", i, err)
		}
	}
	if err := l.Allow("chat-new", "hi"); !isBlock(err) {
		t.Fatal("13th chat in a minute allowed")
	}
	// chats you already wrote to are still fine
	if err := l.Allow("chat3", "follow-up"); err != nil {
		t.Fatalf("follow-up blocked: %v", err)
	}
}

func TestSameTextToManyChats(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	text := "Check out this amazing offer at example.com"
	for i := range 4 {
		if err := l.Allow("chat"+strconv.Itoa(i), text); err != nil {
			t.Fatalf("chat %d: %v", i, err)
		}
		c.add(30 * time.Second)
	}
	// whitespace and case don't get around it
	if err := l.Allow("chat9", "  check out this AMAZING offer at example.com "); !isBlock(err) {
		t.Fatal("same text to a 5th chat allowed")
	}
	// resending to a chat that already got it is not "many chats"
	if err := l.Allow("chat0", text); err != nil {
		t.Fatalf("resend to the same chat blocked: %v", err)
	}
	c.add(11 * time.Minute)
	if err := l.Allow("chat9", text); err != nil {
		t.Fatalf("still blocked after the window: %v", err)
	}
}

func TestBlockedMessageIsNotCounted(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	l := newLimiter(c)
	for i := range 60 {
		l.Allow("a", strconv.Itoa(i))
	}
	for range 5 {
		l.Allow("a", "x")
	}
	if len(l.hist) != 60 {
		t.Errorf("blocked attempts were recorded: %d", len(l.hist))
	}
}
