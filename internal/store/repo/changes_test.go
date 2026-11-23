package repo_test

import (
	"context"
	"testing"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestChangesFeed(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	a, b := "a@s.whatsapp.net", "b@s.whatsapp.net"
	plain := insert(t, db, a, "1", 1, "nothing happened")
	edited := insert(t, db, a, "2", 2, "fixed typo")
	deleted := insert(t, db, b, "3", 3, "oops")
	unknown := insert(t, db, b, "4", 4, "")
	db.ExecContext(ctx, `UPDATE messages SET edit_count = 1, edited_at = 100 WHERE pk = ?`, edited)
	db.ExecContext(ctx, `UPDATE messages SET is_deleted = 1, deleted_at = 200 WHERE pk = ?`, deleted)
	// deleted before we had its content: nothing to show
	db.ExecContext(ctx, `UPDATE messages SET is_deleted = 1, deleted_at = 300, raw = NULL WHERE pk = ?`, unknown)
	_ = plain

	v := repo.View{Me: "me@s.whatsapp.net"}
	all, err := v.Changes(ctx, db, "", 0, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Items) != 2 || all.Items[0].Change != "deleted" || all.Items[0].At != 200 || all.Items[1].Change != "edited" {
		t.Fatalf("all: %+v", all.Items)
	}
	if all.Items[0].ChatJID != b || all.Items[0].Message.Text != "oops" {
		t.Errorf("deleted item: %+v", all.Items[0])
	}

	first, _ := v.Changes(ctx, db, "", 0, 0, 1)
	if len(first.Items) != 1 || !first.HasMore {
		t.Fatalf("page 1: %+v", first)
	}
	second, _ := v.Changes(ctx, db, "", first.Items[0].At, deleted, 1)
	if len(second.Items) != 1 || second.HasMore || second.Items[0].Change != "edited" {
		t.Fatalf("page 2: %+v", second)
	}
	if only, _ := v.Changes(ctx, db, "edited", 0, 0, 10); len(only.Items) != 1 {
		t.Errorf("edited only: %+v", only.Items)
	}
	if _, err := v.Changes(ctx, db, "bogus", 0, 0, 10); err == nil {
		t.Error("unknown kind accepted")
	}
}
