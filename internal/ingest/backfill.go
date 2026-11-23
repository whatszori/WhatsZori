package ingest

import (
	"context"
	"database/sql"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
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
