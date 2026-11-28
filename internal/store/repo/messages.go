package repo

import (
	"context"
	"database/sql"
	"errors"
)

type MessageRow struct {
	PK            int64
	ChatJID       string
	MsgID         string
	SenderJID     string
	FromMe        bool
	PushName      string
	TS            int64
	Kind          string
	Body          string
	QuotedID      string
	QuotedSender  string
	Status        string
	ReadSent      bool
	IsDeleted     bool
	DeletedAt     int64
	DeletedBy     string
	DeleteKind    string
	IsPlaceholder bool
	EditCount     int
	EditedAt      int64
	IsEphemeral   bool
	IsViewOnce    bool
	Raw           []byte
	ForwardScore  int
	// a live location: when it last moved (ms)
	LocUpdatedAt int64
}

// Store kinds. Finer than what the UI shows; domain.UIKind maps them.
const (
	KindText  = "text"
	KindImage = "image"
	KindVideo = "video"
	// video note ("кружок", PtvMessage): a round video, played inline
	KindRound = "round"
	// a GIF: an mp4 that plays muted and loops
	KindGif      = "gif"
	KindAudio    = "audio"
	KindVoice    = "voice"
	KindDocument = "document"
	KindSticker  = "sticker"
	KindLocation = "location"
	KindContact  = "contact"
	KindEvent    = "event"
	KindPoll     = "poll"
	KindUnknown  = "unknown"
)

const msgCols = `pk, chat_jid, msg_id, sender_jid, from_me, push_name, ts, kind, body, quoted_id, quoted_sender,
	status, read_sent, is_deleted, deleted_at, deleted_by, delete_kind, is_placeholder, edit_count, edited_at,
	is_ephemeral, is_view_once, raw, forward_score, loc_updated_at`

func scanMessage(s interface{ Scan(...any) error }) (MessageRow, error) {
	var m MessageRow
	err := s.Scan(&m.PK, &m.ChatJID, &m.MsgID, &m.SenderJID, &m.FromMe, &m.PushName, &m.TS, &m.Kind, &m.Body,
		&m.QuotedID, &m.QuotedSender, &m.Status, &m.ReadSent, &m.IsDeleted, &m.DeletedAt, &m.DeletedBy,
		&m.DeleteKind, &m.IsPlaceholder, &m.EditCount, &m.EditedAt, &m.IsEphemeral, &m.IsViewOnce, &m.Raw, &m.ForwardScore, &m.LocUpdatedAt)
	return m, err
}

func scanMessages(rows *sql.Rows, err error) ([]MessageRow, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MessageRow
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertMessage adds m unless (chat_jid, msg_id) already exists. It returns the pk either way and
// whether this call created the row.
func InsertMessage(ctx context.Context, q DBTX, m *MessageRow) (int64, bool, error) {
	var pk int64
	err := q.QueryRowContext(ctx, `
		INSERT INTO messages (chat_jid, msg_id, sender_jid, from_me, push_name, ts, kind, body, quoted_id,
			quoted_sender, status, read_sent, is_deleted, deleted_at, deleted_by, delete_kind, is_placeholder,
			edit_count, edited_at, is_ephemeral, is_view_once, raw, forward_score)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (chat_jid, msg_id) DO NOTHING
		RETURNING pk`,
		m.ChatJID, m.MsgID, m.SenderJID, b2i(m.FromMe), m.PushName, m.TS, m.Kind, m.Body, m.QuotedID,
		m.QuotedSender, m.Status, b2i(m.ReadSent), b2i(m.IsDeleted), m.DeletedAt, m.DeletedBy, m.DeleteKind,
		b2i(m.IsPlaceholder), m.EditCount, m.EditedAt, b2i(m.IsEphemeral), b2i(m.IsViewOnce), m.Raw, m.ForwardScore,
	).Scan(&pk)
	if err == nil {
		m.PK = pk
		return pk, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}
	err = q.QueryRowContext(ctx, `SELECT pk FROM messages WHERE chat_jid = ? AND msg_id = ?`, m.ChatJID, m.MsgID).Scan(&pk)
	m.PK = pk
	return pk, false, err
}

// FillPlaceholder puts the real content into a row that was created by an early revoke. The
// placeholder flag stays set, so we still know the revoke came first.
func FillPlaceholder(ctx context.Context, q DBTX, pk int64, m *MessageRow) (bool, error) {
	res, err := q.ExecContext(ctx, `
		UPDATE messages SET sender_jid = ?, from_me = ?, push_name = ?, ts = ?, kind = ?, body = ?, quoted_id = ?,
			quoted_sender = ?, is_ephemeral = ?, is_view_once = ?, raw = ?, forward_score = ?
		WHERE pk = ? AND is_placeholder = 1 AND raw IS NULL`,
		m.SenderJID, b2i(m.FromMe), m.PushName, m.TS, m.Kind, m.Body, m.QuotedID, m.QuotedSender,
		b2i(m.IsEphemeral), b2i(m.IsViewOnce), m.Raw, m.ForwardScore, pk)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func GetMessage(ctx context.Context, q DBTX, pk int64) (MessageRow, error) {
	m, err := scanMessage(q.QueryRowContext(ctx, `SELECT `+msgCols+` FROM messages WHERE pk = ?`, pk))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func GetMessageByID(ctx context.Context, q DBTX, chat, msgID string) (MessageRow, error) {
	m, err := scanMessage(q.QueryRowContext(ctx, `SELECT `+msgCols+` FROM messages WHERE chat_jid = ? AND msg_id = ?`, chat, msgID))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func LastMessage(ctx context.Context, q DBTX, chat string) (MessageRow, error) {
	m, err := scanMessage(q.QueryRowContext(ctx, `SELECT `+msgCols+` FROM messages WHERE chat_jid = ? ORDER BY ts DESC, pk DESC LIMIT 1`, chat))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

// Page returns up to limit messages before (ts, pk) of beforePK, oldest first. Keyset pagination on
// (ts, pk), so it stays fast and stable while new messages arrive.
func Page(ctx context.Context, q DBTX, chat string, beforePK int64, limit int) ([]MessageRow, bool, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	var rows []MessageRow
	var err error
	if beforePK > 0 {
		rows, err = scanMessages(q.QueryContext(ctx, `
			SELECT `+msgCols+` FROM messages
			WHERE chat_jid = ?1 AND (ts, pk) < (SELECT ts, pk FROM messages WHERE pk = ?2)
			ORDER BY ts DESC, pk DESC LIMIT ?3`, chat, beforePK, limit+1))
	} else {
		rows, err = scanMessages(q.QueryContext(ctx, `
			SELECT `+msgCols+` FROM messages WHERE chat_jid = ? ORDER BY ts DESC, pk DESC LIMIT ?`, chat, limit+1))
	}
	if err != nil {
		return nil, false, err
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, more, nil
}

func MarkDeleted(ctx context.Context, q DBTX, pk, at int64, by, kind string) error {
	_, err := q.ExecContext(ctx, `UPDATE messages SET is_deleted = 1, deleted_at = ?, deleted_by = ?, delete_kind = ? WHERE pk = ?`, at, by, kind, pk)
	return err
}

// PurgeContent drops what a deleted message said, for when "keep deleted messages" is off. It
// returns the media file (relative to the media folder) that the caller should remove.
func PurgeContent(ctx context.Context, q DBTX, pk int64) (string, error) {
	var local string
	err := q.QueryRowContext(ctx, `SELECT local_path FROM media WHERE message_pk = ?`, pk).Scan(&local)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	for _, s := range []string{
		`UPDATE messages SET body = '', raw = NULL, quoted_id = '', quoted_sender = '' WHERE pk = ?`,
		`DELETE FROM media WHERE message_pk = ?`,
		`DELETE FROM message_edits WHERE message_pk = ?`,
	} {
		if _, err := q.ExecContext(ctx, s, pk); err != nil {
			return "", err
		}
	}
	return local, nil
}

func UpdateBody(ctx context.Context, q DBTX, pk int64, body string, editCount int, editedAt int64) error {
	_, err := q.ExecContext(ctx, `UPDATE messages SET body = ?, edit_count = ?, edited_at = ? WHERE pk = ?`, body, editCount, editedAt, pk)
	return err
}

func SetStatus(ctx context.Context, q DBTX, pk int64, status string) error {
	_, err := q.ExecContext(ctx, `UPDATE messages SET status = ? WHERE pk = ?`, status, pk)
	return err
}

func SetSentTS(ctx context.Context, q DBTX, pk, ts int64) error {
	_, err := q.ExecContext(ctx, `UPDATE messages SET ts = ? WHERE pk = ?`, ts, pk)
	return err
}

type EditRow struct {
	Version  int
	Body     string
	EditedAt int64
}

func InsertEdit(ctx context.Context, q DBTX, pk int64, e EditRow) error {
	_, err := q.ExecContext(ctx, `INSERT OR REPLACE INTO message_edits (message_pk, version, body, edited_at) VALUES (?, ?, ?, ?)`, pk, e.Version, e.Body, e.EditedAt)
	return err
}

func Edits(ctx context.Context, q DBTX, pk int64) ([]EditRow, error) {
	rows, err := q.QueryContext(ctx, `SELECT version, body, edited_at FROM message_edits WHERE message_pk = ? ORDER BY version`, pk)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EditRow
	for rows.Next() {
		var e EditRow
		if err := rows.Scan(&e.Version, &e.Body, &e.EditedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func MaxEditVersion(ctx context.Context, q DBTX, pk int64) (int, bool, error) {
	var v sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT MAX(version) FROM message_edits WHERE message_pk = ?`, pk).Scan(&v)
	return int(v.Int64), v.Valid, err
}

type PendingRead struct {
	MsgID     string
	SenderJID string
	TS        int64
}

// PendingReads lists incoming messages in chat we haven't sent a read receipt for yet.
func PendingReads(ctx context.Context, q DBTX, chat string, sinceTS int64, limit int) ([]PendingRead, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT msg_id, sender_jid, ts FROM messages
		WHERE chat_jid = ? AND from_me = 0 AND read_sent = 0 AND is_placeholder = 0 AND ts >= ?
		ORDER BY ts DESC LIMIT ?`, chat, sinceTS, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingRead
	for rows.Next() {
		var p PendingRead
		if err := rows.Scan(&p.MsgID, &p.SenderJID, &p.TS); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func MarkReadSent(ctx context.Context, q DBTX, chat string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	args := append([]any{chat}, anys(ids)...)
	_, err := q.ExecContext(ctx, `UPDATE messages SET read_sent = 1 WHERE chat_jid = ? AND msg_id IN (`+placeholders(len(ids))+`)`, args...)
	return err
}

// CountIncomingAfter is how many incoming messages are newer than ts; used to recompute unread
// when another of our devices reads part of a chat.
func CountIncomingAfter(ctx context.Context, q DBTX, chat string, ts int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE chat_jid = ? AND from_me = 0 AND ts > ?`, chat, ts).Scan(&n)
	return n, err
}

func MaxTSOf(ctx context.Context, q DBTX, chat string, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var ts sql.NullInt64
	args := append([]any{chat}, anys(ids)...)
	err := q.QueryRowContext(ctx, `SELECT MAX(ts) FROM messages WHERE chat_jid = ? AND msg_id IN (`+placeholders(len(ids))+`)`, args...).Scan(&ts)
	return ts.Int64, err
}

func MessagesByIDs(ctx context.Context, q DBTX, chat string, ids []string) ([]MessageRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	args := append([]any{chat}, anys(ids)...)
	return scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages WHERE chat_jid = ? AND msg_id IN (`+placeholders(len(ids))+`)`, args...))
}

func MessagesByPKs(ctx context.Context, q DBTX, pks []int64) ([]MessageRow, error) {
	if len(pks) == 0 {
		return nil, nil
	}
	return scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages WHERE pk IN (`+placeholders(len(pks))+`) ORDER BY ts, pk`, anys(pks)...))
}
