package wa

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestPickAbout(t *testing.T) {
	pn := types.NewJID("15550100", types.DefaultUserServer)
	lid := types.NewJID("987654321", types.HiddenUserServer)
	cases := map[string]struct {
		info map[types.JID]types.UserInfo
		ask  types.JID
		want string
	}{
		"exact":          {map[types.JID]types.UserInfo{pn: {Status: "hi"}}, pn, "hi"},
		"answer by LID":  {map[types.JID]types.UserInfo{lid: {Status: "hey", LID: lid}}, pn, "hey"},
		"asked by LID":   {map[types.JID]types.UserInfo{pn: {Status: "yo", LID: lid}}, lid, "yo"},
		"device suffix":  {map[types.JID]types.UserInfo{pn: {Status: "ok"}}, types.JID{User: "15550100", Server: types.DefaultUserServer, Device: 3}, "ok"},
		"nothing at all": {map[types.JID]types.UserInfo{}, pn, ""},
	}
	for name, c := range cases {
		if got := pickAbout(c.info, c.ask); got != c.want {
			t.Errorf("%s: %q, want %q", name, got, c.want)
		}
	}
}

func TestMentionsIn(t *testing.T) {
	group := "120363000000000001@g.us"
	text := "@15550100001 and @88001 look"
	got := mentionsIn(group, text, []string{
		"15550100001@s.whatsapp.net",
		"15550100001:5@s.whatsapp.net", // the same person from another device: once
		"88001@lid",
		"15550100003@s.whatsapp.net", // not in the text
		"120363000000000002@g.us",    // not a person
		"garbage",
	})
	if len(got) != 2 || got[0] != "15550100001@s.whatsapp.net" || got[1] != "88001@lid" {
		t.Fatalf("got %v", got)
	}
	if mentionsIn("15550100001@s.whatsapp.net", text, []string{"15550100001@s.whatsapp.net"}) != nil {
		t.Fatal("mentions only make sense in groups")
	}
}
