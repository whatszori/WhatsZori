package repo

import (
	"context"
	"database/sql"
	"errors"
	"sort"
)

// Reactions

// SetReaction records sender's reaction; an empty emoji removes it. Older events than what's
// stored are ignored, since history sync can replay them out of order.
func SetReaction(ctx context.Context, q DBTX, chat, msgID, sender, emoji string, ts int64) error {
	if emoji == "" {
		_, err := q.ExecContext(ctx, `DELETE FROM reactions WHERE chat_jid = ? AND msg_id = ? AND sender_jid = ? AND ts <= ?`, chat, msgID, sender, ts)
		return err
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO reactions (chat_jid, msg_id, sender_jid, emoji, ts) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (chat_jid, msg_id, sender_jid) DO UPDATE SET emoji = excluded.emoji, ts = excluded.ts
		WHERE excluded.ts >= reactions.ts`, chat, msgID, sender, emoji, ts)
	return err
}

type ReactionAgg struct {
	Emoji string
	Count int
	Mine  bool
	First int64
}

// ReactionsFor groups reactions per message id. me is our canonical JID.
func ReactionsFor(ctx context.Context, q DBTX, chat string, ids []string, me string) (map[string][]ReactionAgg, error) {
	out := map[string][]ReactionAgg{}
	if len(ids) == 0 {
		return out, nil
	}
	args := append([]any{me, chat}, anys(ids)...)
	rows, err := q.QueryContext(ctx, `
		SELECT msg_id, emoji, COUNT(*), MAX(sender_jid = ?), MIN(ts) FROM reactions
		WHERE chat_jid = ? AND msg_id IN (`+placeholders(len(ids))+`)
		GROUP BY msg_id, emoji`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var r ReactionAgg
		if err := rows.Scan(&id, &r.Emoji, &r.Count, &r.Mine, &r.First); err != nil {
			return nil, err
		}
		out[id] = append(out[id], r)
	}
	for _, list := range out {
		// first reaction first, like the official clients
		sort.Slice(list, func(i, j int) bool { return list[i].First < list[j].First })
	}
	return out, rows.Err()
}

func MyReaction(ctx context.Context, q DBTX, chat, msgID, me string) (string, error) {
	var e string
	err := q.QueryRowContext(ctx, `SELECT emoji FROM reactions WHERE chat_jid = ? AND msg_id = ? AND sender_jid = ?`, chat, msgID, me).Scan(&e)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return e, err
}

// Receipts

func AddReceipt(ctx context.Context, q DBTX, chat, msgID, participant, typ string, ts int64) error {
	_, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO receipts (chat_jid, msg_id, participant_jid, type, ts) VALUES (?, ?, ?, ?, ?)`, chat, msgID, participant, typ, ts)
	return err
}

// ReceiptCount is how many distinct participants sent a receipt of typ or better (read counts as
// delivered, played counts as read).
func ReceiptCount(ctx context.Context, q DBTX, chat, msgID string, types []string) (int, error) {
	args := append([]any{chat, msgID}, anys(types)...)
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(DISTINCT participant_jid) FROM receipts WHERE chat_jid = ? AND msg_id = ? AND type IN (`+placeholders(len(types))+`)`, args...).Scan(&n)
	return n, err
}

// Media

type MediaRow struct {
	MessagePK     int64
	MediaType     string
	Mime          string
	FileName      string
	Size          int64
	Width         int
	Height        int
	Duration      int
	Waveform      []byte
	MediaKey      []byte
	DirectPath    string
	FileSHA256    []byte
	FileEncSHA256 []byte
	Thumbnail     []byte
	LocalPath     string
	State         string
}

const (
	MediaRemote  = "remote"
	MediaLocal   = "local"
	MediaExpired = "expired"
	MediaFailed  = "failed"
)

func UpsertMedia(ctx context.Context, q DBTX, m MediaRow) error {
	if m.State == "" {
		m.State = MediaRemote
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO media (message_pk, media_type, mime, file_name, size, width, height, duration, waveform, media_key,
			direct_path, file_sha256, file_enc_sha256, thumbnail, local_path, state)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (message_pk) DO UPDATE SET
			media_type = excluded.media_type, mime = excluded.mime, file_name = excluded.file_name,
			size = excluded.size, width = excluded.width, height = excluded.height, duration = excluded.duration,
			waveform = excluded.waveform, media_key = excluded.media_key, direct_path = excluded.direct_path,
			file_sha256 = excluded.file_sha256, file_enc_sha256 = excluded.file_enc_sha256,
			thumbnail = COALESCE(excluded.thumbnail, media.thumbnail)`,
		m.MessagePK, m.MediaType, m.Mime, m.FileName, m.Size, m.Width, m.Height, m.Duration, m.Waveform, m.MediaKey,
		m.DirectPath, m.FileSHA256, m.FileEncSHA256, m.Thumbnail, m.LocalPath, m.State)
	return err
}

const mediaCols = `message_pk, media_type, mime, file_name, size, width, height, duration, waveform, media_key,
	direct_path, file_sha256, file_enc_sha256, thumbnail, local_path, state`

func scanMedia(s interface{ Scan(...any) error }) (MediaRow, error) {
	var m MediaRow
	err := s.Scan(&m.MessagePK, &m.MediaType, &m.Mime, &m.FileName, &m.Size, &m.Width, &m.Height, &m.Duration,
		&m.Waveform, &m.MediaKey, &m.DirectPath, &m.FileSHA256, &m.FileEncSHA256, &m.Thumbnail, &m.LocalPath, &m.State)
	return m, err
}

func GetMedia(ctx context.Context, q DBTX, pk int64) (MediaRow, error) {
	m, err := scanMedia(q.QueryRowContext(ctx, `SELECT `+mediaCols+` FROM media WHERE message_pk = ?`, pk))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func MediaFor(ctx context.Context, q DBTX, pks []int64) (map[int64]MediaRow, error) {
	out := map[int64]MediaRow{}
	if len(pks) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT `+mediaCols+` FROM media WHERE message_pk IN (`+placeholders(len(pks))+`)`, anys(pks)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		out[m.MessagePK] = m
	}
	return out, rows.Err()
}

func SetMediaLocal(ctx context.Context, q DBTX, pk int64, rel string) error {
	_, err := q.ExecContext(ctx, `UPDATE media SET local_path = ?, state = 'local' WHERE message_pk = ?`, rel, pk)
	return err
}

func SetMediaState(ctx context.Context, q DBTX, pk int64, state string) error {
	_, err := q.ExecContext(ctx, `UPDATE media SET state = ? WHERE message_pk = ?`, state, pk)
	return err
}

// Contacts

type ContactRow struct {
	JID          string
	LID          string
	PushName     string
	FullName     string
	FirstName    string
	BusinessName string
	About        string
}

func (c ContactRow) DisplayName() string {
	for _, n := range []string{c.FullName, c.FirstName, c.PushName, c.BusinessName} {
		if n != "" {
			return n
		}
	}
	return ""
}

func ensureContact(ctx context.Context, q DBTX, jid string, now int64) error {
	_, err := q.ExecContext(ctx, `INSERT INTO contacts (jid, updated_at) VALUES (?, ?) ON CONFLICT (jid) DO NOTHING`, jid, now)
	return err
}

func SetPushName(ctx context.Context, q DBTX, jid, name string, now int64) error {
	if err := ensureContact(ctx, q, jid, now); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE contacts SET push_name = ?, updated_at = ? WHERE jid = ?`, name, now, jid)
	return err
}

func SetContactName(ctx context.Context, q DBTX, jid, full, first string, now int64) error {
	if err := ensureContact(ctx, q, jid, now); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE contacts SET full_name = ?, first_name = ?, updated_at = ? WHERE jid = ?`, full, first, now, jid)
	return err
}

func SetBusinessName(ctx context.Context, q DBTX, jid, name string, now int64) error {
	if err := ensureContact(ctx, q, jid, now); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE contacts SET business_name = ?, updated_at = ? WHERE jid = ?`, name, now, jid)
	return err
}

func SetAbout(ctx context.Context, q DBTX, jid, about string, now int64) error {
	if err := ensureContact(ctx, q, jid, now); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE contacts SET about = ?, updated_at = ? WHERE jid = ?`, about, now, jid)
	return err
}

// LinkLID records that lid and pn are the same person and folds a contact row stored under the
// LID into the phone-number one.
func LinkLID(ctx context.Context, q DBTX, pn, lid string, now int64) error {
	if err := ensureContact(ctx, q, pn, now); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE contacts SET lid = ?1,
			push_name = CASE WHEN push_name = '' THEN COALESCE((SELECT push_name FROM contacts WHERE jid = ?1), '') ELSE push_name END,
			full_name = CASE WHEN full_name = '' THEN COALESCE((SELECT full_name FROM contacts WHERE jid = ?1), '') ELSE full_name END,
			first_name = CASE WHEN first_name = '' THEN COALESCE((SELECT first_name FROM contacts WHERE jid = ?1), '') ELSE first_name END,
			updated_at = ?3
		WHERE jid = ?2`, lid, pn, now); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `DELETE FROM contacts WHERE jid = ?`, lid)
	return err
}

const contactCols = `jid, lid, push_name, full_name, first_name, business_name, about`

func scanContact(s interface{ Scan(...any) error }) (ContactRow, error) {
	var c ContactRow
	err := s.Scan(&c.JID, &c.LID, &c.PushName, &c.FullName, &c.FirstName, &c.BusinessName, &c.About)
	return c, err
}

func GetContact(ctx context.Context, q DBTX, jid string) (ContactRow, error) {
	c, err := scanContact(q.QueryRowContext(ctx, `SELECT `+contactCols+` FROM contacts WHERE jid = ?`, jid))
	if errors.Is(err, sql.ErrNoRows) {
		return ContactRow{JID: jid}, ErrNotFound
	}
	return c, err
}

func ContactsFor(ctx context.Context, q DBTX, jids []string) (map[string]ContactRow, error) {
	out := map[string]ContactRow{}
	if len(jids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT `+contactCols+` FROM contacts WHERE jid IN (`+placeholders(len(jids))+`)`, anys(jids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out[c.JID] = c
	}
	return out, rows.Err()
}

func ListContacts(ctx context.Context, q DBTX) ([]ContactRow, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+contactCols+` FROM contacts WHERE full_name <> '' OR first_name <> '' OR push_name <> '' ORDER BY COALESCE(NULLIF(full_name, ''), NULLIF(first_name, ''), push_name) COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ContactRow
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Group participants

type Participant struct {
	JID          string
	IsAdmin      bool
	IsSuperAdmin bool
}

func ReplaceParticipants(ctx context.Context, q DBTX, group string, ps []Participant) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM group_participants WHERE group_jid = ?`, group); err != nil {
		return err
	}
	if err := AddParticipants(ctx, q, group, ps); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE chats SET member_count = ? WHERE jid = ?`, len(ps), group)
	return err
}

func AddParticipants(ctx context.Context, q DBTX, group string, ps []Participant) error {
	for _, p := range ps {
		if _, err := q.ExecContext(ctx, `
			INSERT INTO group_participants (group_jid, member_jid, is_admin, is_super_admin) VALUES (?, ?, ?, ?)
			ON CONFLICT (group_jid, member_jid) DO UPDATE SET is_admin = excluded.is_admin, is_super_admin = excluded.is_super_admin`,
			group, p.JID, b2i(p.IsAdmin), b2i(p.IsSuperAdmin)); err != nil {
			return err
		}
	}
	return nil
}

func RemoveParticipants(ctx context.Context, q DBTX, group string, jids []string) error {
	if len(jids) == 0 {
		return nil
	}
	args := append([]any{group}, anys(jids)...)
	_, err := q.ExecContext(ctx, `DELETE FROM group_participants WHERE group_jid = ? AND member_jid IN (`+placeholders(len(jids))+`)`, args...)
	return err
}

func SetAdmin(ctx context.Context, q DBTX, group string, jids []string, admin bool) error {
	if len(jids) == 0 {
		return nil
	}
	args := append([]any{b2i(admin), group}, anys(jids)...)
	_, err := q.ExecContext(ctx, `UPDATE group_participants SET is_admin = ? WHERE group_jid = ? AND member_jid IN (`+placeholders(len(jids))+`)`, args...)
	return err
}

func Participants(ctx context.Context, q DBTX, group string) ([]Participant, error) {
	rows, err := q.QueryContext(ctx, `SELECT member_jid, is_admin, is_super_admin FROM group_participants WHERE group_jid = ?`, group)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Participant
	for rows.Next() {
		var p Participant
		if err := rows.Scan(&p.JID, &p.IsAdmin, &p.IsSuperAdmin); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func SyncMemberCount(ctx context.Context, q DBTX, group string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET member_count = (SELECT COUNT(*) FROM group_participants WHERE group_jid = ?1) WHERE jid = ?1`, group)
	return err
}
