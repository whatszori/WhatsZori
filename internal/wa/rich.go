package wa

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Contacts, places, polls and events we send. Each goes through prepare (connected, rate limit,
// read-before-reply) and send (stored pending, then sent) like text does.

// SendContacts shares people from our contacts as vCards (with their WhatsApp number, so the
// other side gets a "Message" button).
func (s *Sender) SendContacts(ctx context.Context, chat string, jids []string) (domain.Message, error) {
	if len(jids) == 0 {
		return domain.Message{}, ErrEmpty
	}
	if len(jids) > 20 {
		return domain.Message{}, errors.New("share at most 20 contacts at once")
	}
	rows, err := repo.ContactsFor(ctx, s.DB, jids)
	if err != nil {
		return domain.Message{}, err
	}
	var cards []*waE2E.ContactMessage
	for _, j := range jids {
		pj, err := types.ParseJID(j)
		if err != nil || pj.Server != types.DefaultUserServer {
			return domain.Message{}, fmt.Errorf("%s isn't a phone number contact", j)
		}
		name := rows[j].DisplayName()
		if name == "" {
			name = "+" + pj.User
		}
		cards = append(cards, &waE2E.ContactMessage{DisplayName: proto.String(name), Vcard: proto.String(VCard(name, pj.User))})
	}
	cli, jid, err := s.prepare(ctx, chat, "")
	if err != nil {
		return domain.Message{}, err
	}
	var msg *waE2E.Message
	row := &repo.MessageRow{Kind: repo.KindContact}
	if len(cards) == 1 {
		msg = &waE2E.Message{ContactMessage: cards[0]}
		row.Body = "👤 " + cards[0].GetDisplayName()
	} else {
		label := fmt.Sprintf("%d contacts", len(cards))
		msg = &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{DisplayName: proto.String(label), Contacts: cards}}
		row.Body = "👤 " + label
	}
	return s.send(ctx, cli, jid, chat, msg, row, nil)
}

// VCard is the vCard WhatsApp's phones write for a contact with a WhatsApp number.
func VCard(name, number string) string {
	esc := strings.NewReplacer(`\`, `\\`, ",", `\,`, ";", `\;`, "\n", " ").Replace(name)
	return "BEGIN:VCARD\nVERSION:3.0\nN:;" + esc + ";;;\nFN:" + esc +
		"\nTEL;type=CELL;waid=" + number + ":+" + number + "\nEND:VCARD"
}

// SendLocation sends a pin.
func (s *Sender) SendLocation(ctx context.Context, chat string, p domain.LocationDraft) (domain.Message, error) {
	if math.IsNaN(p.Lat) || math.IsNaN(p.Lon) || p.Lat < -90 || p.Lat > 90 || p.Lon < -180 || p.Lon > 180 {
		return domain.Message{}, errors.New("those aren't coordinates on Earth")
	}
	name, addr := strings.TrimSpace(p.Name), strings.TrimSpace(p.Address)
	cli, jid, err := s.prepare(ctx, chat, name+addr)
	if err != nil {
		return domain.Message{}, err
	}
	loc := &waE2E.LocationMessage{DegreesLatitude: proto.Float64(p.Lat), DegreesLongitude: proto.Float64(p.Lon)}
	if name != "" {
		loc.Name = proto.String(name)
	}
	if addr != "" {
		loc.Address = proto.String(addr)
	}
	body := name
	if body == "" {
		body = addr
	}
	if body == "" {
		body = fmt.Sprintf("Location %.5f, %.5f", p.Lat, p.Lon)
	}
	return s.send(ctx, cli, jid, chat, &waE2E.Message{LocationMessage: loc},
		&repo.MessageRow{Kind: repo.KindLocation, Body: "📍 " + body}, nil)
}

// SendPoll sends a poll; multiple lets people pick more than one option.
func (s *Sender) SendPoll(ctx context.Context, chat, question string, options []string, multiple bool) (domain.Message, error) {
	question = strings.TrimSpace(question)
	var opts []string
	seen := map[string]bool{}
	for _, o := range options {
		o = strings.TrimSpace(o)
		if o != "" && !seen[o] {
			seen[o] = true
			opts = append(opts, o)
		}
	}
	switch {
	case question == "":
		return domain.Message{}, errors.New("the poll needs a question")
	case len(opts) < 2:
		return domain.Message{}, errors.New("a poll needs at least two different options")
	case len(opts) > 12:
		return domain.Message{}, errors.New("a poll has at most 12 options")
	case utf8.RuneCountInString(question) > 255:
		return domain.Message{}, ErrTooLong
	}
	cli, jid, err := s.prepare(ctx, chat, question+strings.Join(opts, "\n"))
	if err != nil {
		return domain.Message{}, err
	}
	selectable := 1
	if multiple {
		selectable = 0
	}
	msg := cli.BuildPollCreation(question, opts, selectable)
	body := "📊 " + question
	for _, o := range opts {
		body += "\n• " + o
	}
	return s.send(ctx, cli, jid, chat, msg, &repo.MessageRow{Kind: repo.KindPoll, Body: body}, nil)
}

// SendEvent sends an event. Answers to it come encrypted with the message secret made here.
func (s *Sender) SendEvent(ctx context.Context, chat string, e domain.EventDraft) (domain.Message, error) {
	e.Name = strings.TrimSpace(e.Name)
	switch {
	case e.Name == "":
		return domain.Message{}, errors.New("the event needs a name")
	case e.Start <= 0:
		return domain.Message{}, errors.New("the event needs a start time")
	case e.End != 0 && e.End < e.Start:
		return domain.Message{}, errors.New("the event ends before it starts")
	case utf8.RuneCountInString(e.Name) > 255 || utf8.RuneCountInString(e.Description) > 2048:
		return domain.Message{}, ErrTooLong
	}
	cli, jid, err := s.prepare(ctx, chat, e.Name+e.Description)
	if err != nil {
		return domain.Message{}, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return domain.Message{}, err
	}
	ev := &waE2E.EventMessage{
		Name: proto.String(e.Name), StartTime: proto.Int64(e.Start / 1000),
		IsCanceled: proto.Bool(false), ExtraGuestsAllowed: proto.Bool(false),
	}
	if d := strings.TrimSpace(e.Description); d != "" {
		ev.Description = proto.String(d)
	}
	if e.End > 0 {
		ev.EndTime = proto.Int64(e.End / 1000)
	}
	if p := strings.TrimSpace(e.Place); p != "" {
		ev.Location = &waE2E.LocationMessage{Name: proto.String(p)}
	}
	if l := strings.TrimSpace(e.JoinLink); l != "" {
		ev.JoinLink = proto.String(l)
	}
	msg := &waE2E.Message{
		EventMessage:       ev,
		MessageContextInfo: &waE2E.MessageContextInfo{MessageSecret: secret},
	}
	return s.send(ctx, cli, jid, chat, msg, &repo.MessageRow{Kind: repo.KindEvent, Body: "📅 " + e.Name}, nil)
}
