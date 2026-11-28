package repo

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestParseVCard(t *testing.T) {
	v := "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nFN:John Doe\r\nORG:Acme\\, Inc.;\r\n" +
		"item1.TEL;waid=15551234567:+1 555-123-4567\r\nitem1.X-ABLabel:Mobile\r\n" +
		"TEL;type=HOME:+1 555 000\r\nEMAIL;type=INTERNET:john@example.com\r\nEND:VCARD"
	c := ParseVCard(v)
	if c.Name != "John Doe" || c.Org != "Acme, Inc." {
		t.Fatalf("name/org: %+v", c)
	}
	if len(c.Phones) != 2 || c.Phones[0].JID != "15551234567@s.whatsapp.net" || c.Phones[1].Label != "home" || c.Phones[1].JID != "" {
		t.Fatalf("phones: %+v", c.Phones)
	}
	if len(c.Emails) != 1 || c.Emails[0] != "john@example.com" {
		t.Fatalf("emails: %+v", c.Emails)
	}
	// no FN: the name comes from N
	if n := ParseVCard("N:Smith;Anna\nTEL:1").Name; n != "Anna Smith" {
		t.Fatalf("N fallback: %q", n)
	}
}

func TestContactCardsAndEvent(t *testing.T) {
	raw, _ := proto.Marshal(&waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{
		Contacts: []*waE2E.ContactMessage{
			{DisplayName: proto.String("A"), Vcard: proto.String("TEL;waid=1:+1")},
			{DisplayName: proto.String("B")},
		},
	}})
	cards := contactCards(raw)
	if len(cards) != 2 || cards[0].Name != "A" || cards[1].Name != "B" || cards[0].Phones[0].WAID != "1" {
		t.Fatalf("cards: %+v", cards)
	}

	raw, _ = proto.Marshal(&waE2E.Message{EventMessage: &waE2E.EventMessage{
		Name: proto.String("Party"), StartTime: proto.Int64(1700000000), IsCanceled: proto.Bool(true),
		Location: &waE2E.LocationMessage{Name: proto.String("Home"), DegreesLatitude: proto.Float64(1)},
	}})
	ev := eventInfo(raw)
	if ev == nil || ev.Name != "Party" || ev.Start != 1700000000000 || !ev.Canceled || ev.Place != "Home" || ev.Lat != 1 {
		t.Fatalf("event: %+v", ev)
	}
	if eventInfo(nil) != nil {
		t.Fatal("nil raw")
	}
}
