package ingest

import (
	"context"
	"strconv"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	evnames "github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestStatusUpdates(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.policy.AutoDownload = false
	status := types.StatusBroadcastJID
	e.handle(t, &events.Message{Info: info(status, alice, "ST1"), Message: &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("good morning"), BackgroundArgb: proto.Uint32(0xff1e88e5)},
	}})
	e.handle(t, &events.Message{Info: info(status, bob, "ST2"), Message: &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{DirectPath: proto.String("/v/st"), MediaKey: []byte{1}, Mimetype: proto.String("image/jpeg"), FileLength: proto.Uint64(30 << 20)},
	}})
	// the poster deletes it: we keep it
	e.handle(t, revokeEvt(status, bob, "ST2", false, bob.String()))

	if len(e.rec.take(evnames.ChatUpdate)) != 0 {
		t.Error("a status showed up as a chat update")
	}
	if len(e.rec.take(evnames.StatusUpdate)) == 0 {
		t.Error("no status:update")
	}
	if len(e.media.queued) != 1 {
		t.Errorf("status photo not downloaded: %v", e.media.queued)
	}
	c, _ := repo.GetChat(ctx, e.db, repo.StatusChat)
	if c.Unread != 0 {
		t.Errorf("statuses counted as unread: %d", c.Unread)
	}

	v := repo.View{Me: me.String()}
	groups, err := v.Statuses(ctx, e.db, 0)
	if err != nil || len(groups) != 2 {
		t.Fatalf("groups: %+v %v", groups, err)
	}
	byJID := map[string]int{}
	for i, g := range groups {
		byJID[g.JID] = i
	}
	a := groups[byJID[alice.String()]]
	if a.Unseen != 1 || a.Items[0].Background != "#1e88e5" || a.Items[0].Message.Text != "good morning" {
		t.Errorf("alice: %+v", a)
	}
	b := groups[byJID[bob.String()]]
	if b.Items[0].Message.Deleted == nil || b.Items[0].Message.Media == nil {
		t.Errorf("deleted status not kept: %+v", b.Items[0].Message)
	}
	apk, _ := strconv.ParseInt(a.Items[0].Message.PK, 10, 64)
	repo.MarkStatusSeen(ctx, e.db, apk, 1)
	groups, _ = v.Statuses(ctx, e.db, 0)
	for _, g := range groups {
		if g.JID == alice.String() && g.Unseen != 0 {
			t.Error("seen status still counted")
		}
	}
	// people with something new come first
	if groups[0].JID != bob.String() {
		t.Errorf("order: %s first", groups[0].JID)
	}
}
