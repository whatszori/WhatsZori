package repo

import (
	"encoding/base64"
	"encoding/json"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Business messages: buttons, lists, templates and "interactive" (native flow) messages. The text
// is the message body like any other; this reads the parts around it and what can be tapped.

// Business sources, which decide what a tap sends back.
const (
	BizButtons     = "buttons"
	BizTemplate    = "template"
	BizList        = "list"
	BizInteractive = "interactive"
)

// BusinessOf reads a stored business message; source is one of the Biz* constants.
func BusinessOf(raw []byte) (info *domain.BusinessInfo, source string) {
	var msg waE2E.Message
	if raw == nil || proto.Unmarshal(raw, &msg) != nil {
		return nil, ""
	}
	return BusinessOfMessage(&msg)
}

func BusinessOfMessage(msg *waE2E.Message) (*domain.BusinessInfo, string) {
	switch {
	case msg.GetButtonsMessage() != nil:
		m := msg.GetButtonsMessage()
		info := newBiz(m.GetText(), m.GetFooterText())
		for _, b := range m.GetButtons() {
			text := b.GetButtonText().GetDisplayText()
			if b.GetType() == waE2E.ButtonsMessage_Button_NATIVE_FLOW {
				nativeButton(info, b.GetNativeFlowInfo().GetName(), b.GetNativeFlowInfo().GetParamsJSON(), text)
				continue
			}
			info.Buttons = append(info.Buttons, domain.BizButton{Kind: "reply", Text: text, ID: b.GetButtonID()})
		}
		return info, BizButtons
	case msg.GetListMessage() != nil:
		m := msg.GetListMessage()
		info := newBiz(m.GetTitle(), m.GetFooterText())
		list := &domain.BizList{Button: firstNonEmptyStr(m.GetButtonText(), "Choose"), Title: m.GetTitle(), Sections: []domain.BizSection{}}
		for _, s := range m.GetSections() {
			sec := domain.BizSection{Title: s.GetTitle(), Rows: []domain.BizRow{}}
			for _, r := range s.GetRows() {
				sec.Rows = append(sec.Rows, domain.BizRow{ID: r.GetRowID(), Title: r.GetTitle(), Description: r.GetDescription()})
			}
			list.Sections = append(list.Sections, sec)
		}
		info.List = list
		info.Buttons = append(info.Buttons, domain.BizButton{Kind: "list", Text: list.Button})
		return info, BizList
	case msg.GetInteractiveMessage() != nil:
		return interactive(msg.GetInteractiveMessage()), BizInteractive
	case msg.GetTemplateMessage() != nil:
		m := msg.GetTemplateMessage()
		if it := m.GetInteractiveMessageTemplate(); it != nil {
			return interactive(it), BizInteractive
		}
		h := m.GetHydratedTemplate()
		if h == nil {
			h = m.GetHydratedFourRowTemplate()
		}
		info := newBiz(h.GetHydratedTitleText(), h.GetHydratedFooterText())
		for _, b := range h.GetHydratedButtons() {
			switch {
			case b.GetQuickReplyButton() != nil:
				q := b.GetQuickReplyButton()
				info.Buttons = append(info.Buttons, domain.BizButton{Kind: "reply", Text: q.GetDisplayText(), ID: q.GetID()})
			case b.GetUrlButton() != nil:
				u := b.GetUrlButton()
				info.Buttons = append(info.Buttons, domain.BizButton{Kind: "url", Text: u.GetDisplayText(), URL: u.GetURL()})
			case b.GetCallButton() != nil:
				c := b.GetCallButton()
				info.Buttons = append(info.Buttons, domain.BizButton{Kind: "call", Text: c.GetDisplayText(), Phone: c.GetPhoneNumber()})
			}
		}
		return info, BizTemplate
	}
	return nil, ""
}

func newBiz(header, footer string) *domain.BusinessInfo {
	return &domain.BusinessInfo{Header: header, Footer: footer, Buttons: []domain.BizButton{}}
}

func interactive(m *waE2E.InteractiveMessage) *domain.BusinessInfo {
	h := m.GetHeader()
	info := newBiz(h.GetTitle(), m.GetFooter().GetText())
	if h.GetSubtitle() != "" {
		info.Subtitle = h.GetSubtitle()
	}
	if b := h.GetJPEGThumbnail(); len(b) > 0 && len(b) <= 256<<10 {
		info.Thumb = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b)
	}
	for _, b := range m.GetNativeFlowMessage().GetButtons() {
		nativeButton(info, b.GetName(), b.GetButtonParamsJSON(), "")
	}
	// a carousel: the cards' own buttons are lost here, but their text isn't
	for _, card := range m.GetCarouselMessage().GetCards() {
		c := interactive(card)
		info.Cards = append(info.Cards, domain.BizCard{Header: c.Header, Body: card.GetBody().GetText(), Footer: c.Footer, Thumb: c.Thumb, Buttons: c.Buttons})
	}
	return info
}

type nativeParams struct {
	DisplayText string `json:"display_text"`
	ID          string `json:"id"`
	URL         string `json:"url"`
	Phone       string `json:"phone_number"`
	Code        string `json:"copy_code"`
	Title       string `json:"title"`
	Sections    []struct {
		Title string `json:"title"`
		Rows  []struct {
			ID          string `json:"id"`
			Header      string `json:"header"`
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"rows"`
	} `json:"sections"`
}

// nativeButton reads one native flow button (its parameters are JSON).
func nativeButton(info *domain.BusinessInfo, name, params, fallback string) {
	var p nativeParams
	_ = json.Unmarshal([]byte(params), &p)
	text := firstNonEmptyStr(p.DisplayText, p.Title, fallback, name)
	b := domain.BizButton{Kind: "other", Text: text, Name: name}
	switch name {
	case "quick_reply":
		b.Kind, b.ID = "reply", p.ID
	case "cta_url":
		b.Kind, b.URL = "url", p.URL
	case "cta_call":
		b.Kind, b.Phone = "call", p.Phone
	case "cta_copy":
		b.Kind, b.Code = "copy", p.Code
	case "single_select":
		b.Kind = "list"
		list := &domain.BizList{Button: text, Title: p.Title, Sections: []domain.BizSection{}}
		for _, s := range p.Sections {
			sec := domain.BizSection{Title: s.Title, Rows: []domain.BizRow{}}
			for _, r := range s.Rows {
				sec.Rows = append(sec.Rows, domain.BizRow{ID: r.ID, Title: firstNonEmptyStr(r.Title, r.Header), Description: r.Description})
			}
			list.Sections = append(list.Sections, sec)
		}
		info.List = list
	}
	info.Buttons = append(info.Buttons, b)
}
