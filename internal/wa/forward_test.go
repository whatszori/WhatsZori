package wa_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

func TestForwardTextAndPhoto(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	bob := types.NewJID("491700000002", types.DefaultUserServer)
	tpk := e.incoming(t, "T1", "look at this")

	// a photo that was itself forwarded twice, in reply to something
	err := e.in.Handle(&events.Message{
		Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: "P1", Timestamp: time.Now()},
		Message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			Caption: proto.String("sunset"), DirectPath: proto.String("/v/x"), MediaKey: []byte{1, 2, 3},
			Mimetype: proto.String("image/jpeg"), FileSHA256: []byte{4}, FileEncSHA256: []byte{5},
			ContextInfo: &waE2E.ContextInfo{IsForwarded: proto.Bool(true), ForwardingScore: proto.Uint32(2), StanzaID: proto.String("X")},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ppk := func() int64 { m, _ := repo.GetMessageByID(ctx, e.db, alice.String(), "P1"); return m.PK }()

	m, err := e.s.Forward(ctx, tpk, bob.String())
	if err != nil {
		t.Fatal(err)
	}
	if m.Text != "look at this" || m.Forwarded != 1 || m.ChatJID != bob.String() {
		t.Errorf("forwarded text: %+v", m)
	}
	ci := e.cli.sent[0].msg.GetExtendedTextMessage().GetContextInfo()
	if !ci.GetIsForwarded() || ci.GetForwardingScore() != 1 || e.cli.sent[0].to != bob {
		t.Errorf("text stanza: %+v to %v", ci, e.cli.sent[0].to)
	}

	m, err = e.s.Forward(ctx, ppk, bob.String())
	if err != nil {
		t.Fatal(err)
	}
	img := e.cli.sent[1].msg.GetImageMessage()
	if img.GetDirectPath() != "/v/x" || img.GetCaption() != "sunset" || img.GetContextInfo().GetForwardingScore() != 3 ||
		img.GetContextInfo().GetStanzaID() != "" {
		t.Errorf("photo stanza: %+v", img)
	}
	if m.Media == nil || m.Forwarded != 3 {
		t.Errorf("forwarded photo: %+v", m)
	}
	// the original shows as forwarded too
	if row, _ := repo.GetMessage(ctx, e.db, ppk); row.ForwardScore != 2 {
		t.Errorf("incoming score = %d", row.ForwardScore)
	}
}

func TestForwardRefusesViewOnce(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	err := e.in.Handle(&events.Message{
		Info:       types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: "V1", Timestamp: time.Now()},
		Message:    &waE2E.Message{ImageMessage: &waE2E.ImageMessage{DirectPath: proto.String("/v/y"), MediaKey: []byte{1}}},
		IsViewOnce: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := repo.GetMessageByID(ctx, e.db, alice.String(), "V1")
	if _, err := e.s.Forward(ctx, row.PK, alice.String()); !errors.Is(err, wa.ErrCantForward) {
		t.Fatalf("err = %v", err)
	}
	if len(e.cli.sent) != 0 {
		t.Error("something was sent")
	}
}
