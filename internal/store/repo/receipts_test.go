package repo_test

import (
	"context"
	"testing"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestMessageReceipts(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	const group = "120363000000000001@g.us"
	const me = "15550100009@s.whatsapp.net"
	const anna, bob, cat = "15550100001@s.whatsapp.net", "15550100002@s.whatsapp.net", "15550100003@s.whatsapp.net"
	repo.EnsureChat(ctx, db, group, true)
	repo.ReplaceParticipants(ctx, db, group, []repo.Participant{{JID: me}, {JID: anna}, {JID: bob}, {JID: cat}})
	repo.SetContactName(ctx, db, anna, "Anna", "", 1)
	repo.SetContactName(ctx, db, bob, "Bob", "", 1)
	repo.SetContactName(ctx, db, cat, "Cat", "", 1)
	repo.InsertMessage(ctx, db, &repo.MessageRow{ChatJID: group, MsgID: "M1", SenderJID: me, FromMe: true, TS: 100, Kind: repo.KindText, Body: "hi"})
	repo.AddReceipt(ctx, db, group, "M1", bob, "delivered", 110)
	repo.AddReceipt(ctx, db, group, "M1", anna, "delivered", 105)
	repo.AddReceipt(ctx, db, group, "M1", anna, "read", 120)

	m, _ := repo.GetMessageByID(ctx, db, group, "M1")
	r, err := repo.View{Me: me}.MessageReceipts(ctx, db, m)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.People) != 3 {
		t.Fatalf("people: %+v", r.People)
	}
	a, b, c := r.People[0], r.People[1], r.People[2]
	if a.Name != "Anna" || a.ReadAt != 120 || a.DeliveredAt != 105 {
		t.Errorf("read first: %+v", a)
	}
	if b.Name != "Bob" || b.DeliveredAt != 110 || b.ReadAt != 0 {
		t.Errorf("then delivered: %+v", b)
	}
	if c.Name != "Cat" || c.DeliveredAt != 0 {
		t.Errorf("then waiting: %+v", c)
	}
}
