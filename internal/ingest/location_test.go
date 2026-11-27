package ingest

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func liveEvt(id string, lat float64, seq int64) *events.Message {
	return &events.Message{Info: info(alice, alice, id), Message: &waE2E.Message{LiveLocationMessage: &waE2E.LiveLocationMessage{
		DegreesLatitude: proto.Float64(lat), DegreesLongitude: proto.Float64(74.6), SequenceNumber: proto.Int64(seq),
		Caption: proto.String("on my way"),
	}}}
}

func TestLiveLocationUpdatesOneBubble(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.handle(t, liveEvt("L1", 42.87, 1))
	// a later position, as a new message id: folded into L1
	e.handle(t, liveEvt("L2", 42.88, 2))
	// an old position arriving late doesn't move the pin back
	e.handle(t, liveEvt("L3", 42.80, 1))

	if _, err := repo.GetMessageByID(ctx, e.db, alice.String(), "L2"); err == nil {
		t.Fatal("an update became its own message")
	}
	m := e.msg(t, alice, "L1")
	ll, ok := repo.LiveLocationOf(m.Raw)
	if !ok || ll.GetDegreesLatitude() != 42.88 || m.LocUpdatedAt == 0 {
		t.Fatalf("not updated: %+v %v", ll, m.LocUpdatedAt)
	}
	msgs, err := repo.View{Me: me.String()}.Messages(ctx, e.db, []repo.MessageRow{m})
	if err != nil {
		t.Fatal(err)
	}
	loc := msgs[0].Location
	if loc == nil || !loc.Live || loc.Lat != 42.88 || loc.Sequence != 2 || msgs[0].Text != "on my way" || msgs[0].Kind != "location" {
		t.Fatalf("dto: %+v text %q kind %s", loc, msgs[0].Text, msgs[0].Kind)
	}
}

func TestPinLocation(t *testing.T) {
	e := newEnv(t)
	e.handle(t, &events.Message{Info: info(alice, alice, "P1"), Message: &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
		DegreesLatitude: proto.Float64(42.8746), DegreesLongitude: proto.Float64(74.5698),
		Name: proto.String("Ala-Too Square"), Address: proto.String("Bishkek"), JPEGThumbnail: []byte{0xff, 0xd8, 0xff},
	}}})
	msgs, err := repo.View{Me: me.String()}.Messages(context.Background(), e.db, []repo.MessageRow{e.msg(t, alice, "P1")})
	if err != nil {
		t.Fatal(err)
	}
	loc := msgs[0].Location
	if loc == nil || loc.Live || loc.Name != "Ala-Too Square" || loc.Thumb == "" || msgs[0].Text != "" {
		t.Fatalf("pin: %+v text %q", loc, msgs[0].Text)
	}
}
