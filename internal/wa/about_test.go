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
