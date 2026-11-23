// Package privacy is the only way out for presence, typing and read receipts. Every one of them
// passes the ghost-mode settings here first; gate_test.go also checks that no other package calls
// the underlying whatsmeow methods.
package privacy

import (
	"context"
	"slices"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/wa"
)

// Reads is where the gate finds messages that still need a read receipt, and records the ones it
// sent. internal/ingest implements it on top of the messages table.
type Reads interface {
	PendingReads(ctx context.Context, chat string) ([]Pending, error)
	MarkReadSent(ctx context.Context, chat string, ids []string) error
}

type Pending struct {
	ID     string
	Sender string
	TS     time.Time
}

type Gate struct {
	reads Reads

	mu    sync.Mutex
	t     wa.PresenceTransport
	ghost domain.GhostSettings
}

func New(reads Reads, ghost domain.GhostSettings) *Gate {
	if ghost.ReadReceipts == "" {
		ghost.ReadReceipts = domain.ReadAlways
	}
	if ghost.GhostChats == nil {
		ghost.GhostChats = []string{}
	}
	return &Gate{reads: reads, ghost: ghost}
}

// SetTransport swaps the client after a re-login. nil means offline: everything is a no-op.
func (g *Gate) SetTransport(t wa.PresenceTransport) {
	g.mu.Lock()
	g.t = t
	g.mu.Unlock()
}

func (g *Gate) Ghost() domain.GhostSettings {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.ghost
}

// SetGhost applies new settings. Turning "hide online" on sends unavailable right away instead of
// waiting for the next reconnect.
func (g *Gate) SetGhost(ctx context.Context, s domain.GhostSettings) error {
	switch s.ReadReceipts {
	case domain.ReadAlways, domain.ReadNever, domain.ReadOnReply:
	default:
		s.ReadReceipts = domain.ReadAlways
	}
	if s.GhostChats == nil {
		s.GhostChats = []string{}
	}
	g.mu.Lock()
	prev := g.ghost
	g.ghost = s
	g.mu.Unlock()
	if prev.HideOnline != s.HideOnline {
		return g.Online(ctx)
	}
	return nil
}

func (g *Gate) transport() (wa.PresenceTransport, domain.GhostSettings) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.t, g.ghost
}

// Online announces our presence after connecting (or after the setting changed): available
// normally, unavailable in ghost mode.
func (g *Gate) Online(ctx context.Context) error {
	t, ghost := g.transport()
	if t == nil {
		return nil
	}
	if ghost.HideOnline {
		return t.SendPresence(ctx, types.PresenceUnavailable)
	}
	return t.SendPresence(ctx, types.PresenceAvailable)
}

// Typing sends composing/paused, unless typing is hidden.
func (g *Gate) Typing(ctx context.Context, chat types.JID, composing bool) error {
	t, ghost := g.transport()
	if t == nil || ghost.HideTyping || ghosted(ghost, chat) {
		return nil
	}
	state := types.ChatPresencePaused
	if composing {
		state = types.ChatPresenceComposing
	}
	return t.SendChatPresence(ctx, chat, state, types.ChatPresenceMediaText)
}

// ChatOpened is the user looking at chat. Only "always" sends read receipts for that.
func (g *Gate) ChatOpened(ctx context.Context, chat types.JID) error {
	if _, ghost := g.transport(); ghost.ReadReceipts != domain.ReadAlways || ghosted(ghost, chat) {
		return nil
	}
	return g.sendReads(ctx, chat)
}

// BeforeSend runs before every outgoing message. In "on-reply" mode that's the moment we admit to
// having read the chat.
func (g *Gate) BeforeSend(ctx context.Context, chat types.JID) error {
	if _, ghost := g.transport(); ghost.ReadReceipts != domain.ReadOnReply || ghosted(ghost, chat) {
		return nil
	}
	return g.sendReads(ctx, chat)
}

func ghosted(ghost domain.GhostSettings, chat types.JID) bool {
	return slices.Contains(ghost.GhostChats, chat.String())
}

// Played is the user listening to a voice note: "played", unless that's hidden for everyone or
// for this chat. sender only matters in groups.
func (g *Gate) Played(ctx context.Context, chat, sender types.JID, id string, ts time.Time) error {
	t, ghost := g.transport()
	if t == nil || ghost.HidePlayed || ghosted(ghost, chat) {
		return nil
	}
	if chat.Server != types.GroupServer {
		sender = types.EmptyJID
	}
	return t.MarkPlayed(ctx, []types.MessageID{id}, ts, chat, sender)
}

// StatusViewed tells poster we saw their status. The UI asks first; with status ghost mode on it
// never goes out, whatever the caller wanted. sent says whether it did.
func (g *Gate) StatusViewed(ctx context.Context, poster types.JID, id string, ts time.Time) (sent bool, err error) {
	t, ghost := g.transport()
	if t == nil || ghost.StatusGhost {
		return false, nil
	}
	if err := t.MarkRead(ctx, []types.MessageID{id}, ts, types.StatusBroadcastJID, poster); err != nil {
		return false, err
	}
	return true, nil
}

func (g *Gate) sendReads(ctx context.Context, chat types.JID) error {
	t, _ := g.transport()
	if t == nil {
		return nil
	}
	key := chat.String()
	pending, err := g.reads.PendingReads(ctx, key)
	if err != nil || len(pending) == 0 {
		return err
	}
	// one receipt per sender: in groups the participant goes into the stanza
	bySender := map[string][]Pending{}
	var order []string
	for _, p := range pending {
		if _, ok := bySender[p.Sender]; !ok {
			order = append(order, p.Sender)
		}
		bySender[p.Sender] = append(bySender[p.Sender], p)
	}
	var sent []string
	var firstErr error
	for _, s := range order {
		list := bySender[s]
		ids := make([]types.MessageID, len(list))
		latest := list[0].TS
		for i, p := range list {
			ids[i] = p.ID
			if p.TS.After(latest) {
				latest = p.TS
			}
		}
		sender := types.EmptyJID
		if chat.Server == types.GroupServer {
			if j, err := types.ParseJID(s); err == nil {
				sender = j
			}
		}
		if err := t.MarkRead(ctx, ids, latest, chat, sender); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		sent = append(sent, ids...)
	}
	if len(sent) > 0 {
		if err := g.reads.MarkReadSent(ctx, key, sent); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
