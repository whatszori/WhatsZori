package wa_test

import (
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func (f *fakeClient) SetDisappearingTimer(ctx context.Context, chat types.JID, timer time.Duration, settingTS time.Time) error {
	f.timer = timer
	return nil
}

func TestDisappearing(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	// the other side turns it on: the chat learns the timer
	err := e.in.Handle(&events.Message{
		Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: "EPH", Timestamp: time.Now()},
		Message: &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
			Type: waE2E.ProtocolMessage_EPHEMERAL_SETTING.Enum(), EphemeralExpiration: proto.Uint32(86400),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if secs, _ := repo.DisappearingOf(ctx, e.db, alice.String()); secs != 86400 {
		t.Fatalf("timer %d", secs)
	}
	// what we send then disappears too
	m, err := e.s.SendText(ctx, alice.String(), "hi", 0)
	if err != nil {
		t.Fatal(err)
	}
	ci := e.cli.sent[0].msg.GetExtendedTextMessage().GetContextInfo()
	if ci.GetExpiration() != 86400 || !m.Disappearing {
		t.Fatalf("sent without the timer: %+v %v", ci, m.Disappearing)
	}
	// and turning it off goes to WhatsApp and the chat
	if err := e.s.SetDisappearing(ctx, alice.String(), 0); err != nil {
		t.Fatal(err)
	}
	if secs, _ := repo.DisappearingOf(ctx, e.db, alice.String()); secs != 0 || e.cli.timer != 0 {
		t.Fatalf("after off: %d", secs)
	}
	if err := e.s.SetDisappearing(ctx, alice.String(), 123); err == nil {
		t.Fatal("odd timer accepted")
	}
}
