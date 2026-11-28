package repo

import (
	"context"
	"errors"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
	"strconv"
	"strings"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
)

func UIKind(kind string) domain.MessageKind {
	switch kind {
	case KindImage:
		return domain.KindImage
	case KindVideo, KindRound, KindGif:
		return domain.KindVideo
	case KindAudio, KindVoice:
		return domain.KindVoice
	case KindDocument:
		return domain.KindDocument
	case KindSticker:
		return domain.KindSticker
	case KindPoll:
		return domain.KindPoll
	case KindLocation:
		return domain.KindLocation
	case KindContact:
		return domain.KindContact
	case KindEvent:
		return domain.KindEvent
	}
	return domain.KindText
}

// FallbackName is what we show when we know nothing about jid: the phone number for PN JIDs.
func FallbackName(jid string) string {
	user, server, _ := strings.Cut(jid, "@")
	if server == "s.whatsapp.net" && user != "" {
		return "+" + user
	}
	return "Unknown"
}

func PhoneOf(jid string) string {
	user, server, _ := strings.Cut(jid, "@")
	if server == "s.whatsapp.net" && user != "" {
		return "+" + user
	}
	return ""
}

// View builds DTOs. Me is our own canonical JID, used for "mine" reactions and sender names.
type View struct {
	Me string
}

func (v View) Name(c ContactRow, jid string) string {
	if jid == v.Me && jid != "" {
		return "You"
	}
	if n := c.DisplayName(); n != "" {
		return n
	}
	return FallbackName(jid)
}

func displayText(m MessageRow) string {
	if m.Kind == KindUnknown && m.Body == "" && m.Raw != nil {
		return "This message type isn't supported yet"
	}
	return m.Body
}

func contentUnknown(m MessageRow) bool {
	return m.Raw == nil && m.Body == "" && (m.IsPlaceholder || m.IsDeleted)
}

func (v View) Messages(ctx context.Context, q DBTX, rows []MessageRow) ([]domain.Message, error) {
	if len(rows) == 0 {
		return []domain.Message{}, nil
	}
	senders := map[string]bool{}
	pks := make([]int64, 0, len(rows))
	byChat := map[string][]string{}
	quoted := map[string][]string{}
	for _, m := range rows {
		senders[m.SenderJID] = true
		if m.DeletedBy != "" {
			senders[m.DeletedBy] = true
		}
		pks = append(pks, m.PK)
		byChat[m.ChatJID] = append(byChat[m.ChatJID], m.MsgID)
		if m.QuotedID != "" {
			quoted[m.ChatJID] = append(quoted[m.ChatJID], m.QuotedID)
			if m.QuotedSender != "" {
				senders[m.QuotedSender] = true
			}
		}
	}

	quotedRows := map[string]MessageRow{}
	for chat, ids := range quoted {
		qs, err := MessagesByIDs(ctx, q, chat, ids)
		if err != nil {
			return nil, err
		}
		for _, qm := range qs {
			quotedRows[chat+"\x00"+qm.MsgID] = qm
			senders[qm.SenderJID] = true
		}
	}

	// mentions: only messages whose text has an "@" can have any worth showing
	mentionsOf := map[int64][]string{}
	var mentioned []string
	addMentions := func(m MessageRow) {
		if _, done := mentionsOf[m.PK]; done || !strings.Contains(m.Body, "@") {
			return
		}
		js := MentionedJIDs(m.Raw)
		mentionsOf[m.PK] = js
		mentioned = append(mentioned, js...)
	}
	for _, m := range rows {
		addMentions(m)
	}
	for _, qm := range quotedRows {
		addMentions(qm)
	}
	people, err := v.resolveMentions(ctx, q, mentioned)
	if err != nil {
		return nil, err
	}
	mentionsFor := func(pk int64) []domain.Mention {
		js := mentionsOf[pk]
		if len(js) == 0 {
			return nil
		}
		out := make([]domain.Mention, 0, len(js))
		for _, j := range js {
			out = append(out, people[j])
		}
		return out
	}

	contacts, err := ContactsFor(ctx, q, keys(senders))
	if err != nil {
		return nil, err
	}
	media, err := MediaFor(ctx, q, pks)
	if err != nil {
		return nil, err
	}
	reactions := map[string]map[string][]ReactionAgg{}
	for chat, ids := range byChat {
		r, err := ReactionsFor(ctx, q, chat, ids, v.Me)
		if err != nil {
			return nil, err
		}
		reactions[chat] = r
	}
	votes := map[string]map[string][]PollVote{}
	for _, m := range rows {
		if m.Kind == KindPoll && votes[m.ChatJID] == nil {
			pv, err := PollVotesFor(ctx, q, m.ChatJID, byChat[m.ChatJID])
			if err != nil {
				return nil, err
			}
			votes[m.ChatJID] = pv
		}
	}

	name := func(jid, pushName string) string {
		c := contacts[jid]
		if c.DisplayName() == "" && pushName != "" && jid != v.Me {
			return pushName
		}
		return v.Name(c, jid)
	}

	out := make([]domain.Message, 0, len(rows))
	for _, m := range rows {
		dto := domain.Message{
			PK:             strconv.FormatInt(m.PK, 10),
			ID:             m.MsgID,
			ChatJID:        m.ChatJID,
			SenderJID:      m.SenderJID,
			SenderName:     name(m.SenderJID, m.PushName),
			FromMe:         m.FromMe,
			Timestamp:      m.TS,
			Kind:           UIKind(m.Kind),
			Text:           displayText(m),
			EditedAt:       m.EditedAt,
			EditCount:      m.EditCount,
			ContentUnknown: contentUnknown(m),
			Forwarded:      m.ForwardScore,
			ViewOnce:       m.IsViewOnce,
			Disappearing:   m.IsEphemeral,
			Reactions:      []domain.Reaction{},
			Mentions:       mentionsFor(m.PK),
			Location:       locationInfo(m),
		}
		if !m.IsDeleted {
			switch m.Kind {
			case KindContact:
				if cards := contactCards(m.Raw); len(cards) > 0 {
					dto.Contacts, dto.Text = cards, ""
				}
			case KindBusiness:
				if b, _ := BusinessOf(m.Raw); b != nil {
					if b.Header == dto.Text {
						b.Header = ""
					}
					dto.Business = b
				}
			case KindEvent, KindUnknown:
				// unknown: events stored before the app knew the invite form
				if ev := eventInfo(m.Raw); ev != nil {
					dto.Event, dto.Text, dto.Kind = ev, "", domain.KindEvent
				}
			}
		}
		if dto.Location != nil && !m.IsDeleted {
			// the bubble draws the place; the text is only what the sender wrote with it
			dto.Text = locationCaption(m.Raw)
		}
		if m.FromMe {
			dto.SenderName = "You"
			dto.Status = domain.MessageStatus(m.Status)
		}
		if med, ok := media[m.PK]; ok {
			dto.Media = mediaInfo(med, m)
			// the caption is the text; the media block shows it below the picture
			dto.Text = m.Body
			if m.Kind == KindBusiness {
				// a business message with a picture, video or file in its header
				dto.Kind = UIKind(med.MediaType)
			}
		}
		if m.IsDeleted {
			dto.Deleted = &domain.DeletedInfo{ByJID: m.DeletedBy, ByName: name(m.DeletedBy, ""), At: m.DeletedAt}
		}
		if m.QuotedID != "" {
			if qm, ok := quotedRows[m.ChatJID+"\x00"+m.QuotedID]; ok {
				dto.ReplyTo = &domain.ReplyRef{
					PK:         strconv.FormatInt(qm.PK, 10),
					SenderName: name(qm.SenderJID, qm.PushName),
					FromMe:     qm.FromMe,
					Kind:       UIKind(qm.Kind),
					Text:       domain.MentionNames(previewText(qm), mentionsFor(qm.PK)),
				}
				if qm.FromMe {
					dto.ReplyTo.SenderName = "You"
				}
			}
		}
		if p, ok := PollOf(m.Raw); ok && m.Kind == KindPoll && !m.IsDeleted {
			pv := votes[m.ChatJID][m.MsgID]
			voters := make([]string, 0, len(pv))
			for _, x := range pv {
				voters = append(voters, x.Voter)
			}
			names, err := ContactsFor(ctx, q, voters)
			if err != nil {
				return nil, err
			}
			dto.Poll = pollInfo(p, pv, v.Me, func(jid string) string { return v.Name(names[jid], jid) })
		}
		if IsChannel(m.ChatJID) {
			// counts come from the server; only our own reaction is known by person
			mine := ""
			for _, r := range reactions[m.ChatJID][m.MsgID] {
				if r.Mine {
					mine = r.Emoji
				}
			}
			dto.Reactions = channelReactions(m.ReactionCounts, mine)
			dto.Views = m.Views
			dto.SenderName = ""
		} else {
			for _, r := range reactions[m.ChatJID][m.MsgID] {
				dto.Reactions = append(dto.Reactions, domain.Reaction{Emoji: r.Emoji, Count: r.Count, Mine: r.Mine})
			}
		}
		out = append(out, dto)
	}
	return out, nil
}

func (v View) Message(ctx context.Context, q DBTX, pk int64) (domain.Message, error) {
	m, err := GetMessage(ctx, q, pk)
	if err != nil {
		return domain.Message{}, err
	}
	list, err := v.Messages(ctx, q, []MessageRow{m})
	if err != nil {
		return domain.Message{}, err
	}
	return list[0], nil
}

func mediaInfo(med MediaRow, m MessageRow) *domain.MediaInfo {
	info := &domain.MediaInfo{
		Width:    med.Width,
		Height:   med.Height,
		FileName: med.FileName,
		Size:     med.Size,
		Mime:     med.Mime,
		Duration: med.Duration,
		Caption:  m.Body,
		Round:    m.Kind == KindRound,
		Gif:      m.Kind == KindGif,
	}
	info.Unavailable = med.State != MediaLocal && med.DirectPath == ""
	for _, b := range med.Waveform {
		info.Waveform = append(info.Waveform, float64(b)/100)
	}
	return info
}

func previewText(m MessageRow) string {
	if m.Body != "" {
		return m.Body
	}
	switch m.Kind {
	case KindImage:
		return "Photo"
	case KindVideo:
		return "Video"
	case KindRound:
		return "Video message"
	case KindGif:
		return "GIF"
	case KindAudio, KindVoice:
		return "Voice message"
	case KindDocument:
		return "Document"
	case KindSticker:
		return "Sticker"
	}
	return ""
}

func (v View) Chat(ctx context.Context, q DBTX, c ChatRow) (domain.Chat, error) {
	contacts, err := ContactsFor(ctx, q, []string{c.JID})
	if err != nil {
		return domain.Chat{}, err
	}
	lists, err := ListsOf(ctx, q)
	if err != nil {
		return domain.Chat{}, err
	}
	return v.chat(ctx, q, c, contacts[c.JID], lists)
}

func (v View) chat(ctx context.Context, q DBTX, c ChatRow, contact ContactRow, lists map[string][]int64) (domain.Chat, error) {
	now := time.Now().UnixMilli()
	dto := domain.Chat{
		JID:          c.JID,
		Name:         c.Name,
		IsGroup:      c.IsGroup,
		MemberCount:  c.MemberCount,
		Pinned:       c.Pinned,
		Archived:     c.Archived,
		Muted:        c.Muted(now),
		Unread:       c.Unread,
		LastActivity: c.LastTS,
		Favorite:     c.Favorite,
		Lists:        lists[c.JID],
		Disappearing: c.Disappearing,
		IsCommunity:  c.IsCommunity,
		IsAnnounce:   c.IsAnnounce,
	}
	if c.ParentJID != "" {
		dto.Community = &domain.CommunityRef{JID: c.ParentJID}
		if p, err := GetChat(ctx, q, c.ParentJID); err == nil {
			dto.Community.Name = p.Name
		}
	}
	if IsChannel(c.JID) {
		dto.Channel = &domain.ChannelInfo{Followers: c.Followers, Verified: c.Verified, Role: c.ChannelRole}
	}
	if dto.Name == "" {
		if c.JID == v.Me {
			dto.Name = "You"
		} else if n := contact.DisplayName(); n != "" {
			dto.Name = n
		} else {
			dto.Name = FallbackName(c.JID)
		}
	}
	last, err := LastMessage(ctx, q, c.JID)
	if errors.Is(err, ErrNotFound) {
		return dto, nil
	} else if err != nil {
		return dto, err
	}
	msgs, err := v.Messages(ctx, q, []MessageRow{last})
	if err != nil {
		return dto, err
	}
	m := msgs[0]
	dto.LastMessage = &domain.MessagePreview{
		PK:         m.PK,
		FromMe:     m.FromMe,
		SenderName: m.SenderName,
		Kind:       m.Kind,
		Text:       domain.MentionNames(previewText(last), m.Mentions),
		Deleted:    m.Deleted != nil,
		Status:     m.Status,
	}
	if last.Kind == KindUnknown && last.Body == "" {
		dto.LastMessage.Text = m.Text
		if m.Event != nil {
			dto.LastMessage.Text = "📅 " + m.Event.Name
		}
	}
	return dto, nil
}

// Chats lists every chat worth showing: groups, and 1:1 chats that have at least one message.
func (v View) Chats(ctx context.Context, q DBTX) ([]domain.Chat, error) {
	rows, err := ListChatRows(ctx, q)
	if err != nil {
		return nil, err
	}
	jids := make([]string, len(rows))
	for i, c := range rows {
		jids[i] = c.JID
	}
	contacts, err := ContactsFor(ctx, q, jids)
	if err != nil {
		return nil, err
	}
	lists, err := ListsOf(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Chat, 0, len(rows))
	for _, c := range rows {
		dto, err := v.chat(ctx, q, c, contacts[c.JID], lists)
		if err != nil {
			return nil, err
		}
		if !dto.IsGroup && dto.Channel == nil && dto.LastMessage == nil {
			continue
		}
		out = append(out, dto)
	}
	return out, nil
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if k != "" {
			out = append(out, k)
		}
	}
	return out
}

// what the sender wrote with a location: a pin's comment or a live location's caption
func locationCaption(raw []byte) string {
	var msg waE2E.Message
	if proto.Unmarshal(raw, &msg) != nil {
		return ""
	}
	if l := msg.GetLocationMessage(); l != nil {
		return l.GetComment()
	}
	return msg.GetLiveLocationMessage().GetCaption()
}
