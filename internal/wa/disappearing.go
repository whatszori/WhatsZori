package wa

import (
	"context"
	"errors"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// the timers WhatsApp offers
var timers = map[int]bool{0: true, 24 * 3600: true, 7 * 24 * 3600: true, 90 * 24 * 3600: true}

var ErrBadTimer = errors.New("disappearing messages can be off, 24 hours, 7 days or 90 days")

// SetDisappearing turns disappearing messages on (seconds) or off (0) for a chat, for everyone in
// it. WhatsZori keeps the messages either way; this is what the others' phones do.
func (s *Sender) SetDisappearing(ctx context.Context, chat string, seconds int) error {
	if !timers[seconds] {
		return ErrBadTimer
	}
	cli, jid, err := s.prepare(ctx, chat, "")
	if err != nil {
		return err
	}
	now := s.now()
	if err := cli.SetDisappearingTimer(ctx, jid, time.Duration(seconds)*time.Second, now); err != nil {
		return err
	}
	if err := repo.SetDisappearing(ctx, s.DB, chat, seconds, now.UnixMilli(), true); err != nil {
		return err
	}
	s.emitChat(ctx, chat)
	return nil
}

// withExpiration marks an outgoing message as disappearing, the way the chat is set: phones
// show a message without it as one that stays, whatever the chat says.
func withExpiration(msg *waE2E.Message, seconds int, settingAt int64) {
	if seconds <= 0 || msg == nil {
		return
	}
	if msg.Conversation != nil {
		msg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{Text: msg.Conversation}
		msg.Conversation = nil
	}
	ci := contextInfoOf(msg)
	if ci == nil {
		return
	}
	ci.Expiration = proto.Uint32(uint32(seconds))
	if settingAt > 0 {
		ci.EphemeralSettingTimestamp = proto.Int64(settingAt / 1000)
	}
}

// contextInfoOf finds (or makes) the context info of the message's content, whatever its type.
func contextInfoOf(msg *waE2E.Message) *waE2E.ContextInfo {
	var out *waE2E.ContextInfo
	msg.ProtoReflect().Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		if fd.Kind() != protoreflect.MessageKind || fd.IsList() || fd.IsMap() {
			return true
		}
		inner := v.Message()
		f := inner.Descriptor().Fields().ByName("contextInfo")
		if f == nil || f.Message() == nil || f.Message().FullName() != (&waE2E.ContextInfo{}).ProtoReflect().Descriptor().FullName() {
			return true
		}
		if !inner.Has(f) {
			inner.Set(f, protoreflect.ValueOfMessage((&waE2E.ContextInfo{}).ProtoReflect()))
		}
		out = inner.Get(f).Message().Interface().(*waE2E.ContextInfo)
		return false
	})
	return out
}
