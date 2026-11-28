package repo

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type ChatRow struct {
	JID         string
	Name        string
	IsGroup     bool
	Pinned      bool
	Archived    bool
	MutedUntil  int64
	Unread      int
	LastTS      int64
	Description string
	CreatedAt   int64
	CreatedBy   string
	MemberCount int
	Favorite    bool
	// disappearing messages timer, seconds (0 = off)
	Disappearing int
	IsCommunity  bool
	ParentJID    string
	IsAnnounce   bool
	// channels
	Followers   int
	Verified    bool
	ChannelRole string
}

func (c ChatRow) Muted(nowMS int64) bool {
	return c.MutedUntil == -1 || c.MutedUntil > nowMS
}

const chatCols = `jid, name, is_group, pinned, archived, muted_until, unread, last_ts, description, created_at, created_by, member_count, favorite,
	disappearing, is_community, parent_jid, is_announce, followers, verified, channel_role`

func scanChat(s interface{ Scan(...any) error }) (ChatRow, error) {
	var c ChatRow
	err := s.Scan(&c.JID, &c.Name, &c.IsGroup, &c.Pinned, &c.Archived, &c.MutedUntil, &c.Unread, &c.LastTS,
		&c.Description, &c.CreatedAt, &c.CreatedBy, &c.MemberCount, &c.Favorite,
		&c.Disappearing, &c.IsCommunity, &c.ParentJID, &c.IsAnnounce, &c.Followers, &c.Verified, &c.ChannelRole)
	return c, err
}

func EnsureChat(ctx context.Context, q DBTX, jid string, isGroup bool) error {
	_, err := q.ExecContext(ctx, `INSERT INTO chats (jid, is_group) VALUES (?, ?) ON CONFLICT (jid) DO NOTHING`, jid, b2i(isGroup))
	return err
}

func GetChat(ctx context.Context, q DBTX, jid string) (ChatRow, error) {
	c, err := scanChat(q.QueryRowContext(ctx, `SELECT `+chatCols+` FROM chats WHERE jid = ?`, jid))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func ListChatRows(ctx context.Context, q DBTX) ([]ChatRow, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+chatCols+` FROM chats WHERE jid <> 'status@broadcast' ORDER BY last_ts DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatRow
	for rows.Next() {
		c, err := scanChat(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func SetChatName(ctx context.Context, q DBTX, jid, name string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET name = ? WHERE jid = ?`, name, jid)
	return err
}

func SetPinned(ctx context.Context, q DBTX, jid string, pinned bool) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET pinned = ? WHERE jid = ?`, b2i(pinned), jid)
	return err
}

func SetArchived(ctx context.Context, q DBTX, jid string, archived bool) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET archived = ? WHERE jid = ?`, b2i(archived), jid)
	return err
}

func SetMutedUntil(ctx context.Context, q DBTX, jid string, until int64) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET muted_until = ? WHERE jid = ?`, until, jid)
	return err
}

func SetUnread(ctx context.Context, q DBTX, jid string, n int) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET unread = ? WHERE jid = ?`, max(n, 0), jid)
	return err
}

func IncUnread(ctx context.Context, q DBTX, jid string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET unread = unread + 1 WHERE jid = ?`, jid)
	return err
}

func BumpLastTS(ctx context.Context, q DBTX, jid string, ts int64) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET last_ts = MAX(last_ts, ?) WHERE jid = ?`, ts, jid)
	return err
}

type GroupMeta struct {
	JID         string
	Name        string
	Description string
	CreatedAt   int64
	CreatedBy   string
	MemberCount int
	IsCommunity bool
	ParentJID   string
	IsAnnounce  bool
}

func UpsertGroup(ctx context.Context, q DBTX, g GroupMeta) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO chats (jid, is_group, name, description, created_at, created_by, member_count, last_ts,
			is_community, parent_jid, is_announce)
		VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET
			is_group = 1,
			is_community = excluded.is_community,
			parent_jid = excluded.parent_jid,
			is_announce = excluded.is_announce,
			name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE chats.name END,
			description = excluded.description,
			created_at = excluded.created_at,
			created_by = excluded.created_by,
			member_count = excluded.member_count,
			-- a group nobody wrote in yet still sorts by when it was made
			last_ts = MAX(chats.last_ts, excluded.last_ts)`,
		g.JID, g.Name, g.Description, g.CreatedAt, g.CreatedBy, g.MemberCount, g.CreatedAt,
		b2i(g.IsCommunity), g.ParentJID, b2i(g.IsAnnounce))
	return err
}

func SetGroupDescription(ctx context.Context, q DBTX, jid, desc string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET description = ? WHERE jid = ?`, desc, jid)
	return err
}

// MergeChat moves everything stored under from (usually a LID) into to (the phone-number JID),
// once we learn they're the same person. Rows that already exist under to win.
func MergeChat(ctx context.Context, q DBTX, from, to string) error {
	if from == to || from == "" || to == "" {
		return nil
	}
	src, err := GetChat(ctx, q, from)
	if errors.Is(err, ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if err := EnsureChat(ctx, q, to, src.IsGroup); err != nil {
		return err
	}
	stmts := []struct {
		sql  string
		args []any
	}{
		{`UPDATE chats SET
			name = CASE WHEN name = '' THEN ? ELSE name END,
			unread = unread + ?, last_ts = MAX(last_ts, ?),
			pinned = MAX(pinned, ?), archived = MIN(archived, ?), muted_until = MAX(muted_until, ?),
			favorite = MAX(favorite, ?)
		  WHERE jid = ?`, []any{src.Name, src.Unread, src.LastTS, b2i(src.Pinned), b2i(src.Archived), src.MutedUntil, b2i(src.Favorite), to}},
		{`UPDATE OR IGNORE chat_list_members SET chat_jid = ? WHERE chat_jid = ?`, []any{to, from}},
		{`UPDATE group_events SET actor_jid = ? WHERE actor_jid = ?`, []any{to, from}},
		{`UPDATE group_events SET target_jid = ? WHERE target_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE messages SET chat_jid = ? WHERE chat_jid = ?`, []any{to, from}},
		{`UPDATE messages SET sender_jid = ? WHERE sender_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE reactions SET chat_jid = ? WHERE chat_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE reactions SET sender_jid = ? WHERE sender_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE receipts SET chat_jid = ? WHERE chat_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE receipts SET participant_jid = ? WHERE participant_jid = ?`, []any{to, from}},
		{`UPDATE OR IGNORE group_participants SET member_jid = ? WHERE member_jid = ?`, []any{to, from}},
		// whatever couldn't move was a duplicate of a row that's already under `to`
		{`DELETE FROM chats WHERE jid = ?`, []any{from}},
		{`DELETE FROM reactions WHERE chat_jid = ? OR sender_jid = ?`, []any{from, from}},
		{`DELETE FROM receipts WHERE chat_jid = ? OR participant_jid = ?`, []any{from, from}},
		{`DELETE FROM group_participants WHERE member_jid = ?`, []any{from}},
	}
	for _, s := range stmts {
		if _, err := q.ExecContext(ctx, s.sql, s.args...); err != nil {
			return err
		}
	}
	return nil
}

// SetDisappearing sets a chat's disappearing messages timer, unless a newer setting is already in.
// at is when it was set (ms); force skips the check (the group's own info is the truth).
func SetDisappearing(ctx context.Context, q DBTX, jid string, seconds int, at int64, force bool) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET disappearing = ?, disappearing_at = MAX(disappearing_at, ?)
		WHERE jid = ? AND (? OR disappearing_at <= ?)`, seconds, at, jid, force, at)
	return err
}

// DisappearingOf is a chat's timer (seconds) and when it was set (ms); zeros when off or unknown.
func DisappearingOf(ctx context.Context, q DBTX, jid string) (int, int64) {
	var secs int
	var at int64
	_ = q.QueryRowContext(ctx, `SELECT disappearing, disappearing_at FROM chats WHERE jid = ?`, jid).Scan(&secs, &at)
	return secs, at
}

// SetParent links a group to its community ("" unlinks it).
func SetParent(ctx context.Context, q DBTX, group, parent string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET parent_jid = ? WHERE jid = ?`, parent, group)
	return err
}

// IsChannel tells channel JIDs (…@newsletter) apart.
func IsChannel(jid string) bool { return strings.HasSuffix(jid, "@newsletter") }
