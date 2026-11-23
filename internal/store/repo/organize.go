package repo

import (
	"context"
	"errors"
	"strings"
)

func SetFavorite(ctx context.Context, q DBTX, jid string, on bool) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET favorite = ? WHERE jid = ?`, b2i(on), jid)
	return err
}

// mediaFiles lists the stored files of a chat's messages, so the caller can delete them after
// the rows are gone.
func mediaFiles(ctx context.Context, q DBTX, chat string) ([]string, error) {
	return scanStrings(q.QueryContext(ctx, `
		SELECT md.local_path FROM media md JOIN messages m ON m.pk = md.message_pk
		WHERE m.chat_jid = ? AND md.local_path <> ''`, chat))
}

// ClearChat removes every message of a chat on this computer but keeps the chat itself. It returns
// the media files that belonged to those messages.
func ClearChat(ctx context.Context, q DBTX, chat string) ([]string, error) {
	files, err := mediaFiles(ctx, q, chat)
	if err != nil {
		return nil, err
	}
	for _, s := range []string{
		`DELETE FROM messages WHERE chat_jid = ?`,
		`DELETE FROM reactions WHERE chat_jid = ?`,
		`DELETE FROM receipts WHERE chat_jid = ?`,
		`UPDATE chats SET unread = 0 WHERE jid = ?`,
	} {
		if _, err := q.ExecContext(ctx, s, chat); err != nil {
			return nil, err
		}
	}
	return files, nil
}

// DeleteMessages removes some messages of a chat on this computer only and returns their media
// files. pks from other chats are ignored.
func DeleteMessages(ctx context.Context, q DBTX, chat string, pks []int64) ([]string, error) {
	if len(pks) == 0 {
		return nil, nil
	}
	in := placeholders(len(pks))
	args := append([]any{chat}, anys(pks)...)
	files, err := scanStrings(q.QueryContext(ctx, `
		SELECT md.local_path FROM media md JOIN messages m ON m.pk = md.message_pk
		WHERE m.chat_jid = ? AND md.local_path <> '' AND m.pk IN (`+in+`)`, args...))
	if err != nil {
		return nil, err
	}
	for _, s := range []string{
		`DELETE FROM reactions WHERE chat_jid = ?1 AND msg_id IN (SELECT msg_id FROM messages WHERE chat_jid = ?1 AND pk IN (` + in + `))`,
		`DELETE FROM receipts WHERE chat_jid = ?1 AND msg_id IN (SELECT msg_id FROM messages WHERE chat_jid = ?1 AND pk IN (` + in + `))`,
		`DELETE FROM messages WHERE chat_jid = ?1 AND pk IN (` + in + `)`,
	} {
		if _, err := q.ExecContext(ctx, s, args...); err != nil {
			return nil, err
		}
	}
	return files, nil
}

// DeleteChat removes the chat and everything in it.
func DeleteChat(ctx context.Context, q DBTX, chat string) ([]string, error) {
	files, err := ClearChat(ctx, q, chat)
	if err != nil {
		return nil, err
	}
	for _, s := range []string{
		`DELETE FROM group_events WHERE group_jid = ?`,
		`DELETE FROM chats WHERE jid = ?`,
	} {
		if _, err := q.ExecContext(ctx, s, chat); err != nil {
			return nil, err
		}
	}
	return files, nil
}

// FileInUse reports whether another message still points at a media file (content-hashed names
// are shared between identical files).
func FileInUse(ctx context.Context, q DBTX, rel string) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM media WHERE local_path = ?`, rel).Scan(&n)
	return n > 0, err
}

// Lists

type ChatList struct {
	ID       int64
	Name     string
	Position int
}

var ErrListName = errors.New("a list needs a name")

func cleanListName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ErrListName
	}
	if r := []rune(name); len(r) > 40 {
		name = string(r[:40])
	}
	return name, nil
}

func Lists(ctx context.Context, q DBTX) ([]ChatList, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name, position FROM chat_lists ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatList
	for rows.Next() {
		var l ChatList
		if err := rows.Scan(&l.ID, &l.Name, &l.Position); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func CreateList(ctx context.Context, q DBTX, name string, now int64) (ChatList, error) {
	name, err := cleanListName(name)
	if err != nil {
		return ChatList{}, err
	}
	var l ChatList
	err = q.QueryRowContext(ctx, `
		INSERT INTO chat_lists (name, position, created_at)
		VALUES (?, COALESCE((SELECT MAX(position) + 1 FROM chat_lists), 0), ?)
		RETURNING id, name, position`, name, now).Scan(&l.ID, &l.Name, &l.Position)
	return l, err
}

func RenameList(ctx context.Context, q DBTX, id int64, name string) error {
	name, err := cleanListName(name)
	if err != nil {
		return err
	}
	res, err := q.ExecContext(ctx, `UPDATE chat_lists SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func DeleteList(ctx context.Context, q DBTX, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM chat_lists WHERE id = ?`, id)
	return err
}

func SetInList(ctx context.Context, q DBTX, id int64, chat string, in bool) error {
	if !in {
		_, err := q.ExecContext(ctx, `DELETE FROM chat_list_members WHERE list_id = ? AND chat_jid = ?`, id, chat)
		return err
	}
	_, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO chat_list_members (list_id, chat_jid) VALUES (?, ?)`, id, chat)
	return err
}

// ListsOf maps chat JIDs to the lists they're in.
func ListsOf(ctx context.Context, q DBTX) (map[string][]int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT chat_jid, list_id FROM chat_list_members ORDER BY list_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]int64{}
	for rows.Next() {
		var jid string
		var id int64
		if err := rows.Scan(&jid, &id); err != nil {
			return nil, err
		}
		out[jid] = append(out[jid], id)
	}
	return out, rows.Err()
}

// Group membership history

type GroupEvent struct {
	TS     int64
	Kind   string
	Actor  string
	Target string
}

const (
	GroupAdd     = "add"
	GroupRemove  = "remove"
	GroupLeave   = "leave"
	GroupJoin    = "join"
	GroupPromote = "promote"
	GroupDemote  = "demote"
	GroupCreate  = "create"
)

func AddGroupEvent(ctx context.Context, q DBTX, group string, e GroupEvent) error {
	_, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO group_events (group_jid, ts, kind, actor_jid, target_jid) VALUES (?, ?, ?, ?, ?)`,
		group, e.TS, e.Kind, e.Actor, e.Target)
	return err
}

func GroupEvents(ctx context.Context, q DBTX, group string, limit int) ([]GroupEvent, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	rows, err := q.QueryContext(ctx, `SELECT ts, kind, actor_jid, target_jid FROM group_events WHERE group_jid = ? ORDER BY ts DESC, id DESC LIMIT ?`, group, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupEvent
	for rows.Next() {
		var e GroupEvent
		if err := rows.Scan(&e.TS, &e.Kind, &e.Actor, &e.Target); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Shared media, docs and links

const (
	SharedMedia = "media"
	SharedDocs  = "docs"
	SharedLinks = "links"
)

var sharedFilter = map[string]string{
	SharedMedia: `kind IN ('image', 'video', 'gif') AND pk IN (SELECT message_pk FROM media)`,
	SharedDocs:  `kind = 'document'`,
	SharedLinks: `(body LIKE '%http://%' OR body LIKE '%https://%' OR body LIKE '%www.%')`,
}

// SharedPage pages a chat's media, documents or link messages, newest first, by (ts, pk).
func SharedPage(ctx context.Context, q DBTX, chat, kind string, beforePK int64, limit int) ([]MessageRow, bool, error) {
	filter, ok := sharedFilter[kind]
	if !ok {
		return nil, false, errors.New("unknown kind " + kind)
	}
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	where := `chat_jid = ?1 AND ` + filter + ` AND NOT (is_deleted = 1 AND raw IS NULL)`
	var rows []MessageRow
	var err error
	if beforePK > 0 {
		rows, err = scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages WHERE `+where+`
			AND (ts, pk) < (SELECT ts, pk FROM messages WHERE pk = ?2) ORDER BY ts DESC, pk DESC LIMIT ?3`, chat, beforePK, limit+1))
	} else {
		rows, err = scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages WHERE `+where+`
			ORDER BY ts DESC, pk DESC LIMIT ?3`, chat, nil, limit+1))
	}
	if err != nil {
		return nil, false, err
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	return rows, more, nil
}

// MessagesBetween returns a chat's messages in [from, to] (ms, 0 = open), oldest first, after
// (ts, pk) of afterPK. For exports, which walk the whole chat in chunks.
func MessagesBetween(ctx context.Context, q DBTX, chat string, from, to, afterTS, afterPK int64, limit int) ([]MessageRow, error) {
	if to <= 0 {
		to = 1<<62 - 1
	}
	return scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages
		WHERE chat_jid = ? AND ts >= ? AND ts <= ? AND (ts, pk) > (?, ?)
		ORDER BY ts, pk LIMIT ?`, chat, from, to, afterTS, afterPK, limit))
}
