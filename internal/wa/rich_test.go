package wa_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

func (f *fakeClient) BuildPollCreation(name string, options []string, selectable int) *waE2E.Message {
	return f.real.BuildPollCreation(name, options, selectable)
}

func TestSendRich(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	repo.EnsureChat(ctx, e.db, alice.String(), false)

	m, err := e.s.SendContacts(ctx, alice.String(), []string{"491709998877@s.whatsapp.net"})
	if err != nil {
		t.Fatal(err)
	}
	vc := e.cli.sent[0].msg.GetContactMessage().GetVcard()
	if !strings.Contains(vc, "waid=491709998877:+491709998877") || m.Kind != domain.KindContact || len(m.Contacts) != 1 || m.Contacts[0].Phones[0].JID == "" {
		t.Fatalf("contact: %q %+v", vc, m)
	}

	m, err = e.s.SendLocation(ctx, alice.String(), domain.LocationDraft{Lat: 52.52, Lon: 13.405, Name: "Brandenburger Tor"})
	if err != nil {
		t.Fatal(err)
	}
	if m.Location == nil || m.Location.Name != "Brandenburger Tor" || m.Text != "" {
		t.Fatalf("location: %+v", m)
	}
	if _, err := e.s.SendLocation(ctx, alice.String(), domain.LocationDraft{Lat: 95}); err == nil {
		t.Fatal("bad latitude accepted")
	}

	m, err = e.s.SendPoll(ctx, alice.String(), "Lunch?", []string{"Pizza", "Sushi", "pizza ", "Pizza"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if m.Poll == nil || len(m.Poll.Options) != 3 || m.Poll.Selectable != 1 {
		t.Fatalf("poll: %+v", m.Poll)
	}
	if _, err := e.s.SendPoll(ctx, alice.String(), "Q", []string{"only"}, false); err == nil {
		t.Fatal("one-option poll accepted")
	}

	start := time.Date(2026, 12, 1, 18, 0, 0, 0, time.UTC).UnixMilli()
	m, err = e.s.SendEvent(ctx, alice.String(), domain.EventDraft{Name: "Party", Start: start, Place: "Home"})
	if err != nil {
		t.Fatal(err)
	}
	last := e.cli.sent[len(e.cli.sent)-1].msg
	if len(last.GetMessageContextInfo().GetMessageSecret()) != 32 || m.Event == nil || m.Event.Start != start || m.Event.Place != "Home" {
		t.Fatalf("event: %+v %+v", m.Event, last.GetMessageContextInfo())
	}
}

func TestInviteKey(t *testing.T) {
	for in, want := range map[string]string{
		"https://whatsapp.com/channel/0029VaABC": "0029VaABC",
		"whatsapp.com/channel/0029VaABC/":        "0029VaABC",
		"https://www.whatsapp.com/channel/K1":    "K1",
		"0029VaABC":                              "0029VaABC",
	} {
		if got, err := wa.InviteKey(in); err != nil || got != want {
			t.Errorf("InviteKey(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "https://example.com/channel/x", "https://whatsapp.com/x/y"} {
		if _, err := wa.InviteKey(bad); err == nil {
			t.Errorf("InviteKey(%q) accepted", bad)
		}
	}
}
