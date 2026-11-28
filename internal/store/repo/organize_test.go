package repo_test

import (
	"context"
	"testing"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestListsAndFavorites(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	insert(t, db, "a@s.whatsapp.net", "1", 1, "hi")
	insert(t, db, "b@s.whatsapp.net", "2", 2, "yo")

	work, err := repo.CreateList(ctx, db, "  Work  ", 1)
	if err != nil || work.Name != "Work" {
		t.Fatalf("create: %+v %v", work, err)
	}
	if _, err := repo.CreateList(ctx, db, "   ", 1); err != repo.ErrListName {
		t.Errorf("empty name: %v", err)
	}
	fam, _ := repo.CreateList(ctx, db, "Family", 2)
	if fam.Position <= work.Position {
		t.Errorf("new lists go last: %d <= %d", fam.Position, work.Position)
	}
	repo.SetInList(ctx, db, work.ID, "a@s.whatsapp.net", true)
	repo.SetInList(ctx, db, work.ID, "a@s.whatsapp.net", true)
	repo.SetInList(ctx, db, fam.ID, "a@s.whatsapp.net", true)
	repo.SetFavorite(ctx, db, "b@s.whatsapp.net", true)

	v := repo.View{Me: "me@s.whatsapp.net"}
	chats, _ := v.Chats(ctx, db)
	got := map[string][]int64{}
	fav := map[string]bool{}
	for _, c := range chats {
		got[c.JID], fav[c.JID] = c.Lists, c.Favorite
	}
	if len(got["a@s.whatsapp.net"]) != 2 || !fav["b@s.whatsapp.net"] || fav["a@s.whatsapp.net"] {
		t.Fatalf("lists %v, favorites %v", got, fav)
	}
	repo.DeleteList(ctx, db, work.ID)
	chats, _ = v.Chats(ctx, db)
	for _, c := range chats {
		if c.JID == "a@s.whatsapp.net" && (len(c.Lists) != 1 || c.Lists[0] != fam.ID) {
			t.Errorf("deleting a list didn't drop its members: %v", c.Lists)
		}
	}
}

func TestClearAndDeleteChat(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	chat := "a@s.whatsapp.net"
	pk := insert(t, db, chat, "1", 1, "hi")
	repo.UpsertMedia(ctx, db, repo.MediaRow{MessagePK: pk, MediaType: "image", LocalPath: "ab/abc.jpg", State: "local"})
	repo.SetReaction(ctx, db, chat, "1", chat, "👍", 2)

	files, err := repo.ClearChat(ctx, db, chat)
	if err != nil || len(files) != 1 || files[0] != "ab/abc.jpg" {
		t.Fatalf("clear: %v %v", files, err)
	}
	if page, _, _ := repo.Page(ctx, db, chat, 0, 10); len(page) != 0 {
		t.Error("messages left after clear")
	}
	if _, err := repo.GetChat(ctx, db, chat); err != nil {
		t.Error("clear removed the chat itself")
	}
	if used, _ := repo.FileInUse(ctx, db, "ab/abc.jpg"); used {
		t.Error("media row survived the clear")
	}
	if _, err := repo.DeleteChat(ctx, db, chat); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetChat(ctx, db, chat); err != repo.ErrNotFound {
		t.Error("chat still there after delete")
	}
}

func TestSharedPage(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	chat := "a@s.whatsapp.net"
	for i, body := range []string{"see https://example.com", "plain", "www.example.org rocks"} {
		insert(t, db, chat, "L"+string(rune('0'+i)), int64(i), body)
	}
	img := insert(t, db, chat, "IMG", 10, "")
	db.ExecContext(ctx, `UPDATE messages SET kind = 'image' WHERE pk = ?`, img)
	repo.UpsertMedia(ctx, db, repo.MediaRow{MessagePK: img, MediaType: "image"})

	links, _, _ := repo.SharedPage(ctx, db, chat, repo.SharedLinks, "", 0, 10)
	if len(links) != 2 {
		t.Errorf("links: %d", len(links))
	}
	media, _, _ := repo.SharedPage(ctx, db, chat, repo.SharedMedia, "", 0, 10)
	if len(media) != 1 || media[0].PK != img {
		t.Errorf("media: %+v", media)
	}
	if _, _, err := repo.SharedPage(ctx, db, chat, "nope", "", 0, 10); err == nil {
		t.Error("unknown kind accepted")
	}
	// search: text and file names; % and _ are literal
	doc := insert(t, db, chat, "DOC", 11, "")
	db.ExecContext(ctx, `UPDATE messages SET kind = 'document' WHERE pk = ?`, doc)
	repo.UpsertMedia(ctx, db, repo.MediaRow{MessagePK: doc, MediaType: "document", FileName: "Invoice_100%.pdf"})
	if hits, _, _ := repo.SharedPage(ctx, db, chat, repo.SharedLinks, "rocks", 0, 10); len(hits) != 1 {
		t.Errorf("link search: %d", len(hits))
	}
	if hits, _, _ := repo.SharedPage(ctx, db, chat, repo.SharedDocs, "invoice_100%", 0, 10); len(hits) != 1 {
		t.Errorf("file name search: %d", len(hits))
	}
	if hits, _, _ := repo.SharedPage(ctx, db, chat, repo.SharedDocs, "invoice%1", 0, 10); len(hits) != 0 {
		t.Errorf("%% matched as a wildcard: %d", len(hits))
	}
}

func TestDeleteSomeMessages(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	chat, other := "a@s.whatsapp.net", "b@s.whatsapp.net"
	keep := insert(t, db, chat, "1", 1, "keep")
	gone := insert(t, db, chat, "2", 2, "gone")
	foreign := insert(t, db, other, "3", 3, "elsewhere")
	repo.UpsertMedia(ctx, db, repo.MediaRow{MessagePK: gone, MediaType: "image", LocalPath: "cd/cde.jpg", State: "local"})
	repo.SetReaction(ctx, db, chat, "2", chat, "x", 2)
	repo.SetReaction(ctx, db, chat, "1", chat, "y", 2)

	files, err := repo.DeleteMessages(ctx, db, chat, []int64{gone, foreign})
	if err != nil || len(files) != 1 || files[0] != "cd/cde.jpg" {
		t.Fatalf("delete: %v %v", files, err)
	}
	page, _, _ := repo.Page(ctx, db, chat, 0, 10)
	if len(page) != 1 || page[0].PK != keep {
		t.Errorf("left: %+v", page)
	}
	if p, _, _ := repo.Page(ctx, db, other, 0, 10); len(p) != 1 {
		t.Error("a message of another chat was deleted")
	}
	var n int
	db.QueryRowContext(ctx, `SELECT COUNT(*) FROM reactions WHERE chat_jid = ?`, chat).Scan(&n)
	if n != 1 {
		t.Errorf("reactions left: %d", n)
	}
}
