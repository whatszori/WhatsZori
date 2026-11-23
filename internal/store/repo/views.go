package repo

import (
	"context"
	"errors"
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
			Reactions:      []domain.Reaction{},
		}
		if m.FromMe {
			dto.SenderName = "You"
			dto.Status = domain.MessageStatus(m.Status)
		}
		if med, ok := media[m.PK]; ok {
			dto.Media = mediaInfo(med, m)
			// the caption is the text; the media block shows it below the picture
			dto.Text = m.Body
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
					Text:       previewText(qm),
				}
				if qm.FromMe {
					dto.ReplyTo.SenderName = "You"
				}
			}
		}
		for _, r := range reactions[m.ChatJID][m.MsgID] {
			dto.Reactions = append(dto.Reactions, domain.Reaction{Emoji: r.Emoji, Count: r.Count, Mine: r.Mine})
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
		Text:       previewText(last),
		Deleted:    m.Deleted != nil,
		Status:     m.Status,
	}
	if last.Kind == KindUnknown && last.Body == "" {
		dto.LastMessage.Text = m.Text
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
		if !dto.IsGroup && dto.LastMessage == nil {
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
