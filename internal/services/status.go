package services

import (
	"context"
	"time"

	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Status is the status updates screen. Everything WhatsApp sends to status@broadcast is kept,
// deleted ones too, with their media.
type Status struct{ c *core.Core }

func NewStatus(c *core.Core) *Status { return &Status{c: c} }

// List returns the last day of statuses, or everything kept when all is set.
func (s *Status) List(all bool) ([]domain.StatusGroup, error) {
	ctx, cancel := call()
	defer cancel()
	var since int64
	if !all {
		since = time.Now().Add(-24 * time.Hour).UnixMilli()
	}
	out, err := s.c.View(ctx).Statuses(ctx, s.c.DB, since)
	if out == nil {
		out = []domain.StatusGroup{}
	}
	return out, err
}

// View records that the user opened a status. With ghost the poster isn't told; without it the
// view receipt goes out unless status ghost mode is on in the settings. sent says whether it did.
func (s *Status) View(pk string, ghost bool) (sent bool, err error) {
	id, err := parsePK(pk)
	if err != nil {
		return false, err
	}
	ctx, cancel := call()
	defer cancel()
	m, err := repo.GetMessage(ctx, s.c.DB, id)
	if err != nil {
		return false, err
	}
	if m.ChatJID != repo.StatusChat {
		return false, errNotStatus
	}
	if err := repo.MarkStatusSeen(ctx, s.c.DB, id, time.Now().UnixMilli()); err != nil {
		return false, err
	}
	if ghost || m.FromMe || m.ReadSent {
		return false, nil
	}
	poster, err := types.ParseJID(m.SenderJID)
	if err != nil {
		return false, err
	}
	sent, err = s.c.Gate.StatusViewed(ctx, poster, m.MsgID, time.UnixMilli(m.TS))
	if sent {
		_ = repo.MarkReadSent(context.Background(), s.c.DB, repo.StatusChat, []string{m.MsgID})
	}
	return sent, err
}
