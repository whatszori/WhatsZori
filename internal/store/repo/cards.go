package repo

import (
	"encoding/base64"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Contact cards (vCards) and events, read from the stored raw proto for the bubbles.

func contactCards(raw []byte) []domain.ContactCard {
	var msg waE2E.Message
	if raw == nil || proto.Unmarshal(raw, &msg) != nil {
		return nil
	}
	var list []*waE2E.ContactMessage
	if c := msg.GetContactMessage(); c != nil {
		list = append(list, c)
	}
	list = append(list, msg.GetContactsArrayMessage().GetContacts()...)
	out := make([]domain.ContactCard, 0, len(list))
	for _, c := range list {
		card := ParseVCard(c.GetVcard())
		if card.Name == "" {
			card.Name = c.GetDisplayName()
		}
		if card.Name == "" && len(card.Phones) > 0 {
			card.Name = card.Phones[0].Number
		}
		out = append(out, card)
	}
	return out
}

// ParseVCard reads the parts of a vCard WhatsApp uses: FN, ORG, TEL (with waid=) and EMAIL.
// vCards fold long lines (a line starting with a space continues the previous one).
func ParseVCard(v string) domain.ContactCard {
	card := domain.ContactCard{Phones: []domain.ContactPhone{}, Emails: []string{}}
	v = strings.ReplaceAll(v, "\r\n", "\n")
	v = strings.ReplaceAll(v, "\n ", "")
	for _, line := range strings.Split(v, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		params := strings.Split(key, ";")
		name := strings.ToUpper(params[0])
		// "item1.TEL" -> "TEL"
		if i := strings.LastIndexByte(name, '.'); i >= 0 {
			name = name[i+1:]
		}
		value = unescapeVCard(strings.TrimSpace(value))
		switch name {
		case "FN":
			card.Name = value
		case "N":
			if card.Name == "" {
				parts := strings.Split(value, ";")
				if len(parts) > 1 {
					card.Name = strings.TrimSpace(parts[1] + " " + parts[0])
				} else {
					card.Name = parts[0]
				}
			}
		case "ORG":
			card.Org = strings.Trim(strings.ReplaceAll(value, ";", " "), " ")
		case "EMAIL":
			if value != "" {
				card.Emails = append(card.Emails, value)
			}
		case "TEL":
			p := domain.ContactPhone{Number: value}
			for _, param := range params[1:] {
				k, val, _ := strings.Cut(param, "=")
				switch strings.ToLower(k) {
				case "waid":
					p.WAID = val
				case "type":
					if p.Label == "" {
						p.Label = strings.ToLower(val)
					}
				}
			}
			if p.WAID != "" {
				p.JID = p.WAID + "@s.whatsapp.net"
			}
			card.Phones = append(card.Phones, p)
		}
	}
	return card
}

func unescapeVCard(s string) string {
	return strings.NewReplacer(`\,`, ",", `\;`, ";", `\n`, " ", `\N`, " ", `\\`, `\`).Replace(s)
}

// eventInfo reads either form: phones now send an EventInviteMessage (title, times, place name,
// a cover picture), older ones and the web an EventMessage.
func eventInfo(raw []byte) *domain.EventInfo {
	var msg waE2E.Message
	if raw == nil || proto.Unmarshal(raw, &msg) != nil {
		return nil
	}
	if inv := msg.GetEventInviteMessage(); inv != nil {
		st := inv.GetStatus()
		info := &domain.EventInfo{
			Name: inv.GetEventTitle(), Description: inv.GetCaption(), JoinLink: inv.GetCallLink(),
			Start: inv.GetStartTime() * 1000, End: inv.GetEndTime() * 1000, Place: inv.GetLocationName(),
			Canceled: inv.GetIsCanceled() || st == waE2E.EventInviteMessage_CANCELED || st == waE2E.EventInviteMessage_DELETED,
			Call:     inv.GetCallLink() != "",
		}
		if b := inv.GetJPEGThumbnail(); len(b) > 0 && len(b) <= 256<<10 {
			info.Cover = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b)
		}
		return info
	}
	e := msg.GetEventMessage()
	if e == nil {
		return nil
	}
	info := &domain.EventInfo{
		Name: e.GetName(), Description: e.GetDescription(), JoinLink: e.GetJoinLink(),
		Start: e.GetStartTime() * 1000, End: e.GetEndTime() * 1000,
		Canceled: e.GetIsCanceled(), Call: e.GetIsScheduleCall(),
	}
	if l := e.GetLocation(); l != nil {
		info.Place = firstNonEmptyStr(l.GetName(), l.GetAddress())
		if l.GetDegreesLatitude() != 0 || l.GetDegreesLongitude() != 0 {
			info.Lat, info.Lon = l.GetDegreesLatitude(), l.GetDegreesLongitude()
		}
	}
	return info
}

func firstNonEmptyStr(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}
