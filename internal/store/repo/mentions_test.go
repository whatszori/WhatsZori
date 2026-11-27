package repo_test

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestMentionsGetNames(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	const group = "120363000000000001@g.us"
	const anna = "15550100001@s.whatsapp.net"
	const annaLID = "88001@lid"
	const bob = "15550100002@s.whatsapp.net"
	if err := repo.EnsureChat(ctx, db, group, true); err != nil {
		t.Fatal(err)
	}
	repo.SetContactName(ctx, db, anna, "Anna Petrova", "Anna", 1)
	repo.LinkLID(ctx, db, anna, annaLID, 1)

	// Anna mentioned by her LID (a LID group), Bob by number with no name we know
	text := "@88001 and @15550100002, dinner at 8?"
	raw, _ := proto.Marshal(&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text:        proto.String(text),
		ContextInfo: &waE2E.ContextInfo{MentionedJID: []string{annaLID, bob + ""}},
	}})
	if _, _, err := repo.InsertMessage(ctx, db, &repo.MessageRow{ChatJID: group, MsgID: "M1", SenderJID: bob, TS: 10,
		Kind: repo.KindText, Body: text, Raw: raw}); err != nil {
		t.Fatal(err)
	}

	rows, _, err := repo.Page(ctx, db, group, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.View{Me: "15550100009@s.whatsapp.net"}.Messages(ctx, db, rows)
	if err != nil {
		t.Fatal(err)
	}
	got := msgs[0].Mentions
	want := []domain.Mention{
		{JID: anna, Token: "88001", Name: "Anna Petrova"},
		{JID: bob, Token: "15550100002", Name: "+15550100002"},
	}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("mentions: %+v", got)
	}
	if s := domain.MentionNames(text, got); s != "@Anna Petrova and @+15550100002, dinner at 8?" {
		t.Fatalf("preview: %q", s)
	}
}
