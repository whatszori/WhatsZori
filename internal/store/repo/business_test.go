package repo

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestBusinessOf(t *testing.T) {
	// buttons
	raw, _ := proto.Marshal(&waE2E.Message{ButtonsMessage: &waE2E.ButtonsMessage{
		Header:      &waE2E.ButtonsMessage_Text{Text: "Shop"},
		ContentText: proto.String("Hi"), FooterText: proto.String("foot"),
		Buttons: []*waE2E.ButtonsMessage_Button{
			{ButtonID: proto.String("b1"), ButtonText: &waE2E.ButtonsMessage_Button_ButtonText{DisplayText: proto.String("Yes")}, Type: waE2E.ButtonsMessage_Button_RESPONSE.Enum()},
		},
	}})
	b, src := BusinessOf(raw)
	if src != BizButtons || b.Header != "Shop" || b.Footer != "foot" || len(b.Buttons) != 1 || b.Buttons[0].ID != "b1" || b.Buttons[0].Kind != "reply" {
		t.Fatalf("buttons: %s %+v", src, b)
	}

	// list
	raw, _ = proto.Marshal(&waE2E.Message{ListMessage: &waE2E.ListMessage{
		Title: proto.String("Menu"), ButtonText: proto.String("Pick"),
		Sections: []*waE2E.ListMessage_Section{{Title: proto.String("A"), Rows: []*waE2E.ListMessage_Row{{RowID: proto.String("r1"), Title: proto.String("Tea")}}}},
	}})
	b, src = BusinessOf(raw)
	if src != BizList || b.List == nil || b.List.Sections[0].Rows[0].ID != "r1" || b.Buttons[0].Kind != "list" || b.Buttons[0].Text != "Pick" {
		t.Fatalf("list: %s %+v", src, b)
	}

	// interactive native flow, inside a template
	raw, _ = proto.Marshal(&waE2E.Message{TemplateMessage: &waE2E.TemplateMessage{
		Format: &waE2E.TemplateMessage_InteractiveMessageTemplate{InteractiveMessageTemplate: &waE2E.InteractiveMessage{
			Header: &waE2E.InteractiveMessage_Header{Title: proto.String("Order")},
			Body:   &waE2E.InteractiveMessage_Body{Text: proto.String("Ready?")},
			InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons: []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
					{Name: proto.String("quick_reply"), ButtonParamsJSON: proto.String(`{"display_text":"OK","id":"ok"}`)},
					{Name: proto.String("cta_url"), ButtonParamsJSON: proto.String(`{"display_text":"Site","url":"https://x.test"}`)},
					{Name: proto.String("cta_copy"), ButtonParamsJSON: proto.String(`{"display_text":"Copy","copy_code":"C1"}`)},
					{Name: proto.String("single_select"), ButtonParamsJSON: proto.String(`{"title":"More","sections":[{"title":"S","rows":[{"id":"x","title":"X"}]}]}`)},
					{Name: proto.String("review_and_pay"), ButtonParamsJSON: proto.String(`{}`)},
				},
			}},
		}},
	}})
	b, src = BusinessOf(raw)
	if src != BizInteractive || b.Header != "Order" || len(b.Buttons) != 5 {
		t.Fatalf("interactive: %s %+v", src, b)
	}
	kinds := ""
	for _, x := range b.Buttons {
		kinds += x.Kind + " "
	}
	if kinds != "reply url copy list other " || b.Buttons[0].ID != "ok" || b.Buttons[1].URL != "https://x.test" || b.Buttons[2].Code != "C1" || b.List.Sections[0].Rows[0].ID != "x" {
		t.Fatalf("native buttons: %q %+v", kinds, b.Buttons)
	}

	// hydrated template
	raw, _ = proto.Marshal(&waE2E.Message{TemplateMessage: &waE2E.TemplateMessage{
		HydratedTemplate: &waE2E.TemplateMessage_HydratedFourRowTemplate{
			HydratedContentText: proto.String("Hello"),
			HydratedButtons: []*waE2E.HydratedTemplateButton{
				{HydratedButton: &waE2E.HydratedTemplateButton_QuickReplyButton{QuickReplyButton: &waE2E.HydratedTemplateButton_HydratedQuickReplyButton{DisplayText: proto.String("Stop"), ID: proto.String("stop")}}},
				{HydratedButton: &waE2E.HydratedTemplateButton_CallButton{CallButton: &waE2E.HydratedTemplateButton_HydratedCallButton{DisplayText: proto.String("Call"), PhoneNumber: proto.String("+1")}}},
			},
		},
	}})
	b, src = BusinessOf(raw)
	if src != BizTemplate || len(b.Buttons) != 2 || b.Buttons[0].ID != "stop" || b.Buttons[1].Phone != "+1" {
		t.Fatalf("template: %s %+v", src, b)
	}

	if b, _ := BusinessOf(nil); b != nil {
		t.Fatal("nil raw")
	}
}
