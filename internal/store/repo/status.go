package repo

import (
	"context"
	"fmt"
	"sort"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// StatusChat is where WhatsApp puts status updates; it never shows in the chat list.
const StatusChat = "status@broadcast"

func MarkStatusSeen(ctx context.Context, q DBTX, pk, at int64) error {
	_, err := q.ExecContext(ctx, `INSERT INTO status_seen (message_pk, seen_at) VALUES (?, ?) ON CONFLICT DO NOTHING`, pk, at)
	return err
}

// Statuses groups the status updates posted since since (unix ms; 0 = everything we kept) by
// poster: ours first, then people with something new, newest first. Deleted ones stay.
func (v View) Statuses(ctx context.Context, q DBTX, since int64) ([]domain.StatusGroup, error) {
	rows, err := scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages
		WHERE chat_jid = ? AND ts >= ? AND NOT (is_placeholder = 1 AND raw IS NULL)
		ORDER BY ts, pk`, StatusChat, since))
	if err != nil {
		return nil, err
	}
	seen := map[int64]bool{}
	if len(rows) > 0 {
		pks := make([]int64, len(rows))
		for i, r := range rows {
			pks[i] = r.PK
		}
		ids, err := scanInts(q.QueryContext(ctx, `SELECT message_pk FROM status_seen WHERE message_pk IN (`+placeholders(len(pks))+`)`, anys(pks)...))
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			seen[id] = true
		}
	}
	msgs, err := v.Messages(ctx, q, rows)
	if err != nil {
		return nil, err
	}
	byPoster := map[string]*domain.StatusGroup{}
	var order []string
	for i, m := range msgs {
		r := rows[i]
		g := byPoster[r.SenderJID]
		if g == nil {
			g = &domain.StatusGroup{JID: r.SenderJID, Name: m.SenderName, Mine: r.FromMe, Items: []domain.StatusItem{}}
			if r.FromMe {
				g.Name = "My status"
			}
			byPoster[r.SenderJID] = g
			order = append(order, r.SenderJID)
		}
		item := domain.StatusItem{Message: m, Seen: seen[r.PK] || r.FromMe, Background: statusBackground(r.Raw)}
		if !item.Seen {
			g.Unseen++
		}
		g.LastTS = max(g.LastTS, r.TS)
		g.Items = append(g.Items, item)
	}
	out := make([]domain.StatusGroup, 0, len(order))
	for _, jid := range order {
		out = append(out, *byPoster[jid])
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Mine != b.Mine {
			return a.Mine
		}
		if (a.Unseen > 0) != (b.Unseen > 0) {
			return a.Unseen > 0
		}
		return a.LastTS > b.LastTS
	})
	return out, nil
}

// statusBackground is the colour behind a text status, as #rrggbb.
func statusBackground(raw []byte) string {
	if raw == nil {
		return ""
	}
	var msg waE2E.Message
	if proto.Unmarshal(raw, &msg) != nil {
		return ""
	}
	et := msg.GetExtendedTextMessage()
	if et == nil || et.BackgroundArgb == nil {
		return ""
	}
	return fmt.Sprintf("#%06x", et.GetBackgroundArgb()&0xffffff)
}
