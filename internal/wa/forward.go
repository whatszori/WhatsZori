package wa

import (
	"context"
	"errors"
	"fmt"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// MaxForwardChats is WhatsApp's own limit for one forward.
const MaxForwardChats = 5

var ErrCantForward = errors.New("this message can't be forwarded")

// Forward sends a copy of message pk to chat, marked "Forwarded" the way WhatsApp does it. Media
// isn't uploaded again: the copy points at the same encrypted file on WhatsApp's servers.
func (s *Sender) Forward(ctx context.Context, pk int64, chat string) (domain.Message, error) {
	src, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return domain.Message{}, err
	}
	msg, err := forwardable(src)
	if err != nil {
		return domain.Message{}, err
	}
	cli, jid, err := s.prepare(ctx, chat, src.Body)
	if err != nil {
		return domain.Message{}, err
	}
	row := &repo.MessageRow{Kind: src.Kind, Body: src.Body, ForwardScore: forwardScore(msg)}
	var media *repo.MediaRow
	if m, err := repo.GetMedia(ctx, s.DB, pk); err == nil {
		media = &m
	}
	return s.send(ctx, cli, jid, chat, msg, row, media)
}

// forwardable builds the message to send for a stored one: the original content with the reply
// and mention context dropped and the forwarding flag and score set.
func forwardable(src repo.MessageRow) (*waE2E.Message, error) {
	if src.IsDeleted && src.Raw == nil || src.IsViewOnce || src.Kind == repo.KindPoll || src.Kind == repo.KindUnknown {
		return nil, ErrCantForward
	}
	msg := &waE2E.Message{}
	if src.Raw != nil {
		if err := proto.Unmarshal(src.Raw, msg); err != nil {
			return nil, fmt.Errorf("stored message: %w", err)
		}
	} else if src.Body != "" {
		msg.Conversation = proto.String(src.Body)
	} else {
		return nil, ErrCantForward
	}
	msg.MessageContextInfo = nil
	if msg.Conversation != nil {
		msg = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: msg.Conversation}}
	}
	if et := msg.GetExtendedTextMessage(); et != nil {
		// a fresh text, not the old link preview or styling
		msg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{Text: et.Text, ContextInfo: et.ContextInfo,
			MatchedText: et.MatchedText, Title: et.Title, Description: et.Description, JPEGThumbnail: et.JPEGThumbnail}
	}
	ci := contextOf(msg)
	if ci == nil {
		return nil, ErrCantForward
	}
	score := (*ci).GetForwardingScore() + 1
	*ci = &waE2E.ContextInfo{IsForwarded: proto.Bool(true), ForwardingScore: proto.Uint32(score)}
	return msg, nil
}

// contextOf points at the ContextInfo field of the one content message in msg, or nil when it's
// something we don't forward.
func contextOf(msg *waE2E.Message) **waE2E.ContextInfo {
	switch {
	case msg.ExtendedTextMessage != nil:
		return &msg.ExtendedTextMessage.ContextInfo
	case msg.ImageMessage != nil:
		return &msg.ImageMessage.ContextInfo
	case msg.VideoMessage != nil:
		return &msg.VideoMessage.ContextInfo
	case msg.PtvMessage != nil:
		return &msg.PtvMessage.ContextInfo
	case msg.AudioMessage != nil:
		return &msg.AudioMessage.ContextInfo
	case msg.DocumentMessage != nil:
		return &msg.DocumentMessage.ContextInfo
	case msg.StickerMessage != nil:
		return &msg.StickerMessage.ContextInfo
	case msg.LocationMessage != nil:
		return &msg.LocationMessage.ContextInfo
	case msg.ContactMessage != nil:
		return &msg.ContactMessage.ContextInfo
	case msg.ContactsArrayMessage != nil:
		return &msg.ContactsArrayMessage.ContextInfo
	}
	return nil
}

func forwardScore(msg *waE2E.Message) int {
	if ci := contextOf(msg); ci != nil {
		return int((*ci).GetForwardingScore())
	}
	return 0
}
