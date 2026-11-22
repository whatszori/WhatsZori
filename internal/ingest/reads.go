package ingest

import (
	"context"
	"database/sql"
	"time"

	"github.com/whatszori/WhatsZori/internal/privacy"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Reads feeds the privacy gate from the messages table.
type Reads struct {
	DB *sql.DB
}

var _ privacy.Reads = Reads{}

// old unread messages don't need a receipt anymore, and a huge receipt stanza helps nobody
const (
	readsWindow = 7 * 24 * time.Hour
	readsLimit  = 300
)

func (r Reads) PendingReads(ctx context.Context, chat string) ([]privacy.Pending, error) {
	rows, err := repo.PendingReads(ctx, r.DB, chat, time.Now().Add(-readsWindow).UnixMilli(), readsLimit)
	if err != nil {
		return nil, err
	}
	out := make([]privacy.Pending, len(rows))
	for i, p := range rows {
		out[i] = privacy.Pending{ID: p.MsgID, Sender: p.SenderJID, TS: time.UnixMilli(p.TS)}
	}
	return out, nil
}

func (r Reads) MarkReadSent(ctx context.Context, chat string, ids []string) error {
	return repo.MarkReadSent(ctx, r.DB, chat, ids)
}
