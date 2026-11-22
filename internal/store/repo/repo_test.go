package repo_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestMigrateFromScratch(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "whatszori.db")
	db, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	v, err := store.Version(ctx, db)
	if err != nil || v < 1 {
		t.Fatalf("version = %d, %v", v, err)
	}
	var fk, wal string
	db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&fk)
	db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&wal)
	if fk != "1" || wal != "wal" {
		t.Errorf("foreign_keys=%s journal_mode=%s", fk, wal)
	}
	for _, table := range []string{"chats", "contacts", "group_participants", "messages", "message_edits", "media",
		"reactions", "receipts", "messages_fts", "extensions", "plugin_settings", "plugin_storage"} {
		var n int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&n); err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}
	db.Close()

	// reopening is a no-op
	db, err = store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if v2, _ := store.Version(ctx, db); v2 != v {
		t.Errorf("version changed on reopen: %d -> %d", v, v2)
	}
}

func TestRefusesNewerDB(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	if _, err := db.ExecContext(ctx, "PRAGMA user_version = 999"); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx, db); err == nil {
		t.Fatal("expected an error for a db from a newer build")
	}
}

func insert(t *testing.T, db repo.DBTX, chat, id string, ts int64, body string) int64 {
	t.Helper()
	ctx := context.Background()
	if err := repo.EnsureChat(ctx, db, chat, false); err != nil {
		t.Fatal(err)
	}
	pk, created, err := repo.InsertMessage(ctx, db, &repo.MessageRow{ChatJID: chat, MsgID: id, SenderJID: chat, TS: ts, Kind: repo.KindText, Body: body, Raw: []byte{1}})
	if err != nil || !created {
		t.Fatalf("insert %s: created=%v err=%v", id, created, err)
	}
	return pk
}

func TestInsertIsIdempotent(t *testing.T) {
	db := openDB(t)
	pk := insert(t, db, "a@s.whatsapp.net", "X", 1, "hi")
	pk2, created, err := repo.InsertMessage(context.Background(), db, &repo.MessageRow{ChatJID: "a@s.whatsapp.net", MsgID: "X", SenderJID: "a", TS: 2, Kind: "text", Body: "other"})
	if err != nil || created || pk2 != pk {
		t.Fatalf("second insert: pk=%d created=%v err=%v", pk2, created, err)
	}
	m, _ := repo.GetMessage(context.Background(), db, pk)
	if m.Body != "hi" {
		t.Errorf("body overwritten: %q", m.Body)
	}
}

func TestPageKeyset(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	chat := "a@s.whatsapp.net"
	// several messages share a timestamp, so ordering has to fall back to pk
	for i := range 25 {
		insert(t, db, chat, "m"+strconv.Itoa(i), int64(1000+i/3), strconv.Itoa(i))
	}
	insert(t, db, "b@s.whatsapp.net", "other", 5000, "other chat")

	var seen []string
	before := int64(0)
	for range 10 {
		page, more, err := repo.Page(ctx, db, chat, before, 10)
		if err != nil {
			t.Fatal(err)
		}
		for i := len(page) - 1; i >= 0; i-- {
			seen = append(seen, page[i].Body)
		}
		if !more {
			break
		}
		before = page[0].PK
	}
	if len(seen) != 25 {
		t.Fatalf("got %d messages, want 25: %v", len(seen), seen)
	}
	for i, body := range seen {
		if want := strconv.Itoa(24 - i); body != want {
			t.Fatalf("position %d = %s, want %s (%v)", i, body, want, seen)
		}
	}
	page, more, _ := repo.Page(ctx, db, chat, 0, 10)
	if !more || len(page) != 10 || page[9].Body != "24" || page[0].Body != "15" {
		t.Errorf("first page wrong: more=%v len=%d", more, len(page))
	}
}

func TestSearchFTS(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	pk := insert(t, db, "a@s.whatsapp.net", "1", 1, "Let's grab coffee tomorrow")
	insert(t, db, "a@s.whatsapp.net", "2", 2, "Kaffee? Nein, Tee")
	insert(t, db, "a@s.whatsapp.net", "3", 3, "Привет, как дела")

	v := repo.View{Me: "me@s.whatsapp.net"}
	check := func(q string, want int) {
		t.Helper()
		hits, err := v.Search(ctx, db, q, 10)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if len(hits) != want {
			t.Errorf("search %q: %d hits, want %d", q, len(hits), want)
		}
	}
	check("coff", 1)
	check("tee", 1)
	check("привет", 1)
	check(`"; DROP TABLE messages; --`, 0)
	check("", 0)

	// edits keep the index in sync through the update trigger
	if err := repo.UpdateBody(ctx, db, pk, "tea instead", 1, 10); err != nil {
		t.Fatal(err)
	}
	check("coffee", 0)
	check("tea", 1)
}

func TestMergeChat(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	lid, pn := "123@lid", "491701234567@s.whatsapp.net"
	insert(t, db, lid, "A", 1, "from lid")
	insert(t, db, pn, "B", 2, "from pn")
	insert(t, db, lid, "B", 2, "duplicate")
	repo.SetReaction(ctx, db, lid, "A", lid, "👍", 3)

	if err := repo.MergeChat(ctx, db, lid, pn); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetChat(ctx, db, lid); err != repo.ErrNotFound {
		t.Errorf("lid chat still there: %v", err)
	}
	page, _, _ := repo.Page(ctx, db, pn, 0, 10)
	if len(page) != 2 {
		t.Fatalf("got %d messages after merge, want 2", len(page))
	}
	r, _ := repo.ReactionsFor(ctx, db, pn, []string{"A"}, pn)
	if len(r["A"]) != 1 || !r["A"][0].Mine {
		t.Errorf("reaction not moved: %+v", r)
	}
}
