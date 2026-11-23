package repo

import (
	"context"
	"fmt"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// when a message changed last: deleted beats edited
const changeAt = `CASE WHEN is_deleted = 1 THEN deleted_at ELSE edited_at END`

// Changes is the "Deleted & edited" feed across all chats, latest change first. kind is "deleted",
// "edited" or "" for both. Deletions we have no content for are left out: nothing to show.
// Paging goes on from (beforeAt, beforePK); zero starts at the top.
func (v View) Changes(ctx context.Context, q DBTX, kind string, beforeAt, beforePK int64, limit int) (domain.ChangePage, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	deleted := `(is_deleted = 1 AND (raw IS NOT NULL OR body <> ''))`
	edited := `(edit_count > 0)`
	var where string
	switch kind {
	case "deleted":
		where = deleted
	case "edited":
		where = edited + ` AND is_deleted = 0`
	case "":
		where = `(` + deleted + ` OR ` + edited + `)`
	default:
		return domain.ChangePage{}, fmt.Errorf("unknown change kind %q", kind)
	}
	args := []any{}
	if beforeAt > 0 {
		where += ` AND (` + changeAt + ` < ? OR (` + changeAt + ` = ? AND pk < ?))`
		args = append(args, beforeAt, beforeAt, beforePK)
	}
	args = append(args, limit+1)
	rows, err := scanMessages(q.QueryContext(ctx, `SELECT `+msgCols+` FROM messages WHERE `+where+`
		ORDER BY `+changeAt+` DESC, pk DESC LIMIT ?`, args...))
	if err != nil {
		return domain.ChangePage{}, err
	}
	page := domain.ChangePage{Items: []domain.ChangeItem{}, HasMore: len(rows) > limit}
	if page.HasMore {
		rows = rows[:limit]
	}
	msgs, err := v.Messages(ctx, q, rows)
	if err != nil {
		return page, err
	}
	names := map[string]string{}
	for i, m := range msgs {
		name, ok := names[m.ChatJID]
		if !ok {
			if c, err := GetChat(ctx, q, m.ChatJID); err == nil {
				if dto, err := v.Chat(ctx, q, c); err == nil {
					name = dto.Name
				}
			}
			names[m.ChatJID] = name
		}
		item := domain.ChangeItem{ChatJID: m.ChatJID, ChatName: name, Message: m, Change: "edited", At: rows[i].EditedAt}
		if rows[i].IsDeleted {
			item.Change, item.At = "deleted", rows[i].DeletedAt
		}
		page.Items = append(page.Items, item)
	}
	return page, nil
}
