// Package antispam sits in front of every send. A person chatting never gets near these limits;
// a script blasting the same text to everyone does, and that's what gets accounts banned.
package antispam

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Limits struct {
	// distinct chats you can send to within a minute
	ChatsPerMinute int
	// messages overall within a minute
	MessagesPerMinute int
	// the same text may go to this many different chats within SameTextWindow
	SameTextChats  int
	SameTextWindow time.Duration
	// shorter texts ("ok", "thanks", an emoji) don't count for the same-text rule
	SameTextMinRunes int
}

func DefaultLimits() Limits {
	return Limits{
		ChatsPerMinute:    12,
		MessagesPerMinute: 60,
		SameTextChats:     4,
		SameTextWindow:    10 * time.Minute,
		SameTextMinRunes:  12,
	}
}

// Error is what the UI shows as a toast.
type Error struct{ Reason string }

func (e *Error) Error() string { return e.Reason }

type sent struct {
	at   time.Time
	chat string
	text string
}

type Limiter struct {
	limits Limits
	now    func() time.Time

	mu   sync.Mutex
	hist []sent
}

func New(l Limits) *Limiter {
	return &Limiter{limits: l, now: time.Now}
}

func normalize(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}

// Allow checks one outgoing message and records it if it's allowed. text is empty for media
// without a caption.
func (l *Limiter) Allow(chat, text string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	keep := l.limits.SameTextWindow
	if keep < time.Minute {
		keep = time.Minute
	}
	cut := 0
	for cut < len(l.hist) && now.Sub(l.hist[cut].at) > keep {
		cut++
	}
	l.hist = l.hist[cut:]

	norm := normalize(text)
	perMinute := 0
	chats := map[string]bool{}
	sameText := map[string]bool{}
	for _, s := range l.hist {
		age := now.Sub(s.at)
		if age <= time.Minute {
			perMinute++
			chats[s.chat] = true
		}
		if norm != "" && s.text == norm && age <= l.limits.SameTextWindow {
			sameText[s.chat] = true
		}
	}

	if perMinute >= l.limits.MessagesPerMinute {
		return &Error{fmt.Sprintf("Slow down: that's %d messages in the last minute. Wait a moment before sending more.", perMinute)}
	}
	if !chats[chat] && len(chats) >= l.limits.ChatsPerMinute {
		return &Error{fmt.Sprintf("Slow down: you've written to %d different chats in the last minute. Wait a moment before starting another.", len(chats))}
	}
	if utf8.RuneCountInString(norm) >= l.limits.SameTextMinRunes && !sameText[chat] && len(sameText) >= l.limits.SameTextChats {
		return &Error{fmt.Sprintf("Blocked: the same message already went to %d chats in the last few minutes. WhatsZori doesn't send bulk messages, since that can get your account banned.", len(sameText))}
	}
	l.hist = append(l.hist, sent{at: now, chat: chat, text: norm})
	return nil
}
