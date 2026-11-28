package ingest

import (
	"context"
	"database/sql"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Backfill runs the data fixes this db hasn't had yet. Each one runs once, in a transaction.
func (in *Ingester) Backfill(ctx context.Context) error {
	fixes := []struct {
		name string
		fn   func(ctx context.Context, tx *sql.Tx) error
	}{
		// builds before video-note support stored them as plain videos
		{"round-videos", backfillRoundVideos},
		{"gifs", backfillGifs},
		// stored as "unknown" by builds that didn't know the type yet (events, business messages,
		// album items); bump the name when a later build learns more types
		{"recheck-unknown-1", in.recheckUnknown},
	}
	for _, f := range fixes {
		var n int
		if err := in.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM backfills WHERE name = ?`, f.name).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		err := store.InTx(ctx, in.db, func(tx *sql.Tx) error {
			if err := f.fn(ctx, tx); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO backfills (name, done_at) VALUES (?, ?)`, f.name, time.Now().UnixMilli())
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func backfillGifs(ctx context.Context, tx *sql.Tx) error {
	return retag(ctx, tx, repo.KindGif, func(m *waE2E.Message) bool { return m.GetVideoMessage().GetGifPlayback() })
}

func backfillRoundVideos(ctx context.Context, tx *sql.Tx) error {
	return retag(ctx, tx, repo.KindRound, func(m *waE2E.Message) bool { return m.GetPtvMessage() != nil })
}

// retag moves stored videos whose raw proto matches to a finer kind
func retag(ctx context.Context, tx *sql.Tx, kind string, match func(*waE2E.Message) bool) error {
	rows, err := tx.QueryContext(ctx, `SELECT pk, raw FROM messages WHERE kind = ? AND raw IS NOT NULL`, repo.KindVideo)
	if err != nil {
		return err
	}
	var round []int64
	for rows.Next() {
		var pk int64
		var raw []byte
		if err := rows.Scan(&pk, &raw); err != nil {
			rows.Close()
			return err
		}
		var m waE2E.Message
		if proto.Unmarshal(raw, &m) == nil && match(&m) {
			round = append(round, pk)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, pk := range round {
		if _, err := tx.ExecContext(ctx, `UPDATE messages SET kind = ? WHERE pk = ?`, kind, pk); err != nil {
			return err
		}
	}
	return nil
}

// recheckUnknown reads "unknown" messages again with what this build knows: ones it can show get
// their kind, text and media; control messages (album markers) that never were messages go.
func (in *Ingester) recheckUnknown(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT pk, raw FROM messages WHERE kind = ? AND raw IS NOT NULL`, repo.KindUnknown)
	if err != nil {
		return err
	}
	type found struct {
		pk  int64
		msg *waE2E.Message
	}
	var list []found
	for rows.Next() {
		var f found
		var raw []byte
		if err := rows.Scan(&f.pk, &raw); err != nil {
			rows.Close()
			return err
		}
		var m waE2E.Message
		if proto.Unmarshal(raw, &m) == nil {
			f.msg = unwrapMore(&m)
			list = append(list, f)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, f := range list {
		if isControl(f.msg) || isMetaOnly(f.msg) {
			if _, err := tx.ExecContext(ctx, `DELETE FROM messages WHERE pk = ?`, f.pk); err != nil {
				return err
			}
			continue
		}
		c := extract(f.msg)
		if c.kind == repo.KindUnknown {
			continue
		}
		raw, err := proto.Marshal(f.msg)
		if err != nil {
			return err
		}
		quotedSender := ""
		if c.quotedSender != "" {
			if j, err := types.ParseJID(c.quotedSender); err == nil {
				quotedSender = in.jids.Key(ctx, j)
			}
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE messages SET kind = ?, body = ?, raw = ?, quoted_id = ?, quoted_sender = ?, forward_score = ? WHERE pk = ?`,
			c.kind, c.body, raw, c.quotedID, quotedSender, c.forwardScore, f.pk); err != nil {
			return err
		}
		if c.media != nil {
			c.media.MessagePK = f.pk
			if err := repo.UpsertMedia(ctx, tx, *c.media); err != nil {
				return err
			}
		}
	}
	return nil
}
