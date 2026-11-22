package repo

import (
	"context"
	"strconv"
	"strings"
	"unicode"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// ftsQuery turns what the user typed into an FTS5 query: every word is a quoted prefix term, so
// punctuation can't be read as FTS syntax and "hel wor" finds "hello world".
func ftsQuery(s string) string {
	words := strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	var terms []string
	for _, w := range words {
		terms = append(terms, `"`+strings.ReplaceAll(w, `"`, `""`)+`"*`)
	}
	return strings.Join(terms, " ")
}

func (v View) Search(ctx context.Context, q DBTX, query string, limit int) ([]domain.SearchHit, error) {
	fq := ftsQuery(query)
	if fq == "" {
		return []domain.SearchHit{}, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := scanMessages(q.QueryContext(ctx, `
		SELECT `+prefixed("m.", msgCols)+` FROM messages_fts f JOIN messages m ON m.pk = f.rowid
		WHERE messages_fts MATCH ? ORDER BY m.ts DESC LIMIT ?`, fq, limit))
	if err != nil {
		return nil, err
	}
	msgs, err := v.Messages(ctx, q, rows)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	out := make([]domain.SearchHit, 0, len(msgs))
	for _, m := range msgs {
		name, ok := names[m.ChatJID]
		if !ok {
			if c, err := GetChat(ctx, q, m.ChatJID); err == nil {
				if dto, err := v.Chat(ctx, q, c); err == nil {
					name = dto.Name
				}
			}
			names[m.ChatJID] = name
		}
		out = append(out, domain.SearchHit{ChatJID: m.ChatJID, ChatName: name, Message: m})
	}
	return out, nil
}

func prefixed(p, cols string) string {
	parts := strings.Split(cols, ",")
	for i, c := range parts {
		parts[i] = p + strings.TrimSpace(c)
	}
	return strings.Join(parts, ", ")
}

func (v View) ChatInfo(ctx context.Context, q DBTX, jid string) (domain.ChatInfo, error) {
	c, err := GetChat(ctx, q, jid)
	if err != nil {
		return domain.ChatInfo{}, err
	}
	info := domain.ChatInfo{JID: jid, RecentMedia: []domain.MediaRef{}}
	err = q.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(kind IN ('image', 'video')), 0),
			COALESCE(SUM(kind = 'document'), 0),
			COALESCE(SUM(body LIKE '%http://%' OR body LIKE '%https://%'), 0),
			COALESCE(SUM(is_deleted = 1 AND raw IS NOT NULL), 0),
			COALESCE(SUM(edit_count > 0), 0)
		FROM messages WHERE chat_jid = ?`, jid).Scan(&info.MediaCount, &info.DocCount, &info.LinkCount, &info.DeletedKept, &info.Edited)
	if err != nil {
		return info, err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT m.pk, m.kind, md.width, md.height, md.duration FROM messages m JOIN media md ON md.message_pk = m.pk
		WHERE m.chat_jid = ? AND m.kind IN ('image', 'video') ORDER BY m.ts DESC LIMIT 6`, jid)
	if err != nil {
		return info, err
	}
	for rows.Next() {
		var pk int64
		var kind string
		var r domain.MediaRef
		if err := rows.Scan(&pk, &kind, &r.Width, &r.Height, &r.Duration); err != nil {
			rows.Close()
			return info, err
		}
		r.PK = strconv.FormatInt(pk, 10)
		r.Kind = UIKind(kind)
		info.RecentMedia = append(info.RecentMedia, r)
	}
	rows.Close()

	if !c.IsGroup {
		ct, _ := GetContact(ctx, q, jid)
		info.About = ct.About
		info.Phone = PhoneOf(jid)
		return info, nil
	}
	info.About = c.Description
	info.CreatedAt = c.CreatedAt
	if c.CreatedBy != "" {
		ct, _ := GetContact(ctx, q, c.CreatedBy)
		info.CreatedBy = v.Name(ct, c.CreatedBy)
	}
	ps, err := Participants(ctx, q, jid)
	if err != nil {
		return info, err
	}
	jids := make([]string, len(ps))
	for i, p := range ps {
		jids[i] = p.JID
	}
	contacts, err := ContactsFor(ctx, q, jids)
	if err != nil {
		return info, err
	}
	for _, p := range ps {
		info.Members = append(info.Members, domain.GroupMember{
			JID:     p.JID,
			Name:    v.Name(contacts[p.JID], p.JID),
			Phone:   PhoneOf(p.JID),
			IsMe:    p.JID == v.Me,
			IsAdmin: p.IsAdmin || p.IsSuperAdmin,
		})
	}
	return info, nil
}
