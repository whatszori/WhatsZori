package wa

import (
	"context"
	"encoding/json"
	"errors"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

var ErrNoSuchButton = errors.New("that button isn't in this message")

// Answer taps a reply button or picks a list row of a business message: it sends the answer
// the business expects (the button or row id, not just its text), quoting the message.
func (s *Sender) Answer(ctx context.Context, pk int64, id string) (domain.Message, error) {
	m, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return domain.Message{}, err
	}
	if m.Kind != repo.KindBusiness || m.IsDeleted {
		return domain.Message{}, ErrNoSuchButton
	}
	var orig waE2E.Message
	if proto.Unmarshal(m.Raw, &orig) != nil {
		return domain.Message{}, ErrNoSuchButton
	}
	info, source := repo.BusinessOfMessage(&orig)
	if info == nil {
		return domain.Message{}, ErrNoSuchButton
	}
	text, native, ok := pick(info, id)
	if !ok {
		return domain.Message{}, ErrNoSuchButton
	}
	cli, jid, err := s.prepare(ctx, m.ChatJID, text)
	if err != nil {
		return domain.Message{}, err
	}
	ci := s.quote(ctx, cli, m)
	var msg *waE2E.Message
	switch source {
	case repo.BizButtons:
		msg = &waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{
			SelectedButtonID: proto.String(id),
			Response:         &waE2E.ButtonsResponseMessage_SelectedDisplayText{SelectedDisplayText: text},
			Type:             waE2E.ButtonsResponseMessage_DISPLAY_TEXT.Enum(),
			ContextInfo:      ci,
		}}
	case repo.BizTemplate:
		var index uint32
		h := orig.GetTemplateMessage().GetHydratedTemplate()
		if h == nil {
			h = orig.GetTemplateMessage().GetHydratedFourRowTemplate()
		}
		for _, b := range h.GetHydratedButtons() {
			if b.GetQuickReplyButton().GetID() == id {
				index = b.GetIndex()
			}
		}
		msg = &waE2E.Message{TemplateButtonReplyMessage: &waE2E.TemplateButtonReplyMessage{
			SelectedID: proto.String(id), SelectedDisplayText: proto.String(text),
			SelectedIndex: proto.Uint32(index), ContextInfo: ci,
		}}
	case repo.BizList:
		msg = &waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{
			Title:             proto.String(text),
			ListType:          waE2E.ListResponseMessage_SINGLE_SELECT.Enum(),
			SingleSelectReply: &waE2E.ListResponseMessage_SingleSelectReply{SelectedRowID: proto.String(id)},
			ContextInfo:       ci,
		}}
	default:
		// native flow: the button's name and its id as JSON, like the phone sends
		params, _ := json.Marshal(map[string]string{"id": id})
		msg = &waE2E.Message{InteractiveResponseMessage: &waE2E.InteractiveResponseMessage{
			Body: &waE2E.InteractiveResponseMessage_Body{Text: proto.String(text), Format: waE2E.InteractiveResponseMessage_Body_DEFAULT.Enum()},
			InteractiveResponseMessage: &waE2E.InteractiveResponseMessage_NativeFlowResponseMessage_{
				NativeFlowResponseMessage: &waE2E.InteractiveResponseMessage_NativeFlowResponseMessage{
					Name: proto.String(native), ParamsJSON: proto.String(string(params)), Version: proto.Int32(3),
				},
			},
			ContextInfo: ci,
		}}
	}
	row := &repo.MessageRow{Kind: repo.KindText, Body: text, QuotedID: m.MsgID, QuotedSender: m.SenderJID}
	return s.send(ctx, cli, jid, m.ChatJID, msg, row, nil)
}

// pick finds a reply button or list row by id: its text, and the native flow name it came from.
func pick(info *domain.BusinessInfo, id string) (text, native string, ok bool) {
	if id == "" {
		return "", "", false
	}
	for _, b := range info.Buttons {
		if b.Kind == "reply" && b.ID == id {
			return b.Text, "quick_reply", true
		}
	}
	if info.List != nil {
		for _, sec := range info.List.Sections {
			for _, r := range sec.Rows {
				if r.ID == id {
					return r.Title, "single_select", true
				}
			}
		}
	}
	return "", "", false
}
