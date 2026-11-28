package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// Messages to send later.

type ScheduledRow struct {
	ID        int64
	ChatJID   string
	Body      string
	Mentions  []string
	ReplyTo   int64
	SendAt    int64
	CreatedAt int64
	Error     string
}

const schedCols = `id, chat_jid, body, mentions, reply_to, send_at, created_at, error`

var ErrNotScheduled = errors.New("that scheduled message is gone (sent or deleted)")

func scanScheduled(rows *sql.Rows, err error) ([]ScheduledRow, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScheduledRow
	for rows.Next() {
		var r ScheduledRow
		var mentions string
		if err := rows.Scan(&r.ID, &r.ChatJID, &r.Body, &mentions, &r.ReplyTo, &r.SendAt, &r.CreatedAt, &r.Error); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(mentions), &r.Mentions)
		out = append(out, r)
	}
	return out, rows.Err()
}

func AddScheduled(ctx context.Context, q DBTX, r ScheduledRow) (int64, error) {
	if r.Mentions == nil {
		r.Mentions = []string{}
	}
	m, _ := json.Marshal(r.Mentions)
	res, err := q.ExecContext(ctx, `INSERT INTO scheduled (chat_jid, body, mentions, reply_to, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ChatJID, r.Body, string(m), r.ReplyTo, r.SendAt, r.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetScheduled(ctx context.Context, q DBTX, id int64) (ScheduledRow, error) {
	rows, err := scanScheduled(q.QueryContext(ctx, `SELECT `+schedCols+` FROM scheduled WHERE id = ?`, id))
	if err != nil {
		return ScheduledRow{}, err
	}
	if len(rows) == 0 {
		return ScheduledRow{}, ErrNotFound
	}
	return rows[0], nil
}

// ListScheduled lists a chat's scheduled messages, or everyone's for chat "", soonest first.
func ListScheduled(ctx context.Context, q DBTX, chat string) ([]ScheduledRow, error) {
	return scanScheduled(q.QueryContext(ctx, `SELECT `+schedCols+` FROM scheduled WHERE ? = '' OR chat_jid = ? ORDER BY send_at, id`, chat, chat))
}

// DueScheduled lists what should have gone out by now.
func DueScheduled(ctx context.Context, q DBTX, now int64) ([]ScheduledRow, error) {
	return scanScheduled(q.QueryContext(ctx, `SELECT `+schedCols+` FROM scheduled WHERE send_at <= ? ORDER BY send_at, id`, now))
}

func UpdateScheduled(ctx context.Context, q DBTX, id int64, body string, sendAt int64) error {
	res, err := q.ExecContext(ctx, `UPDATE scheduled SET body = ?, send_at = ?, error = '' WHERE id = ?`, body, sendAt, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func SetScheduledError(ctx context.Context, q DBTX, id int64, msg string) error {
	_, err := q.ExecContext(ctx, `UPDATE scheduled SET error = ? WHERE id = ?`, msg, id)
	return err
}

func DeleteScheduled(ctx context.Context, q DBTX, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM scheduled WHERE id = ?`, id)
	return err
}
