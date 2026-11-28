package ingest

import (
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestChannels(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	ch := types.NewJID("120363000000000099", types.NewsletterServer)
	meta := &types.NewsletterMetadata{ID: ch, ThreadMeta: types.NewsletterThreadMetadata{
		Name: types.NewsletterText{Text: "News"}, SubscriberCount: 1200, VerificationState: types.NewsletterVerificationStateVerified,
	}, ViewerMeta: &types.NewsletterViewerMetadata{Role: types.NewsletterRoleSubscriber}}
	if err := e.in.SyncChannels(ctx, []*types.NewsletterMetadata{meta}); err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(-time.Hour)
	posts := []*types.NewsletterMessage{
		{MessageServerID: 100, MessageID: "P1", Timestamp: at, ViewsCount: 50, ReactionCounts: map[string]int{"👍": 3},
			Message: &waE2E.Message{Conversation: proto.String("first post")}},
		{MessageServerID: 101, MessageID: "P2", Timestamp: at.Add(time.Minute), Message: &waE2E.Message{Conversation: proto.String("second")}},
	}
	if err := e.in.ChannelPosts(ctx, ch, posts); err != nil {
		t.Fatal(err)
	}
	p1 := e.msg(t, ch, "P1")
	if p1.ServerID != 100 || p1.Views != 50 || p1.SenderJID != ch.String() {
		t.Fatalf("post: %+v", p1)
	}
	// a live update moves the numbers
	err := e.in.Handle(&events.NewsletterLiveUpdate{JID: ch, Messages: []*types.NewsletterMessage{
		{MessageServerID: 100, ViewsCount: 80, ReactionCounts: map[string]int{"👍": 4, "🔥": 1}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	v := repo.View{Me: "me@s.whatsapp.net"}
	dto, err := v.Message(ctx, e.db, p1.PK)
	if err != nil {
		t.Fatal(err)
	}
	if dto.Views != 80 || len(dto.Reactions) != 2 || dto.Reactions[0].Emoji != "👍" || dto.Reactions[0].Count != 4 {
		t.Fatalf("stats: views %d reactions %+v", dto.Views, dto.Reactions)
	}
	c, _ := repo.GetChat(ctx, e.db, ch.String())
	chat, _ := v.Chat(ctx, e.db, c)
	if chat.Channel == nil || chat.Channel.Followers != 1200 || !chat.Channel.Verified || chat.Name != "News" {
		t.Fatalf("channel: %+v %+v", chat, chat.Channel)
	}
	// unfollowed elsewhere: the role goes, the posts stay
	if err := e.in.SyncChannels(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if c, _ := repo.GetChat(ctx, e.db, ch.String()); c.ChannelRole != "" {
		t.Fatal("still following")
	}
	// an edited post: new content under the old id
	err = e.in.Handle(&events.Message{
		Info:           types.MessageInfo{MessageSource: types.MessageSource{Chat: ch, Sender: ch}, ID: "P2", ServerID: 101, Timestamp: time.Now()},
		Message:        &waE2E.Message{Conversation: proto.String("second, fixed")},
		NewsletterMeta: &events.NewsletterMessageMeta{EditTS: time.Now()},
	})
	if err != nil {
		t.Fatal(err)
	}
	if m := e.msg(t, ch, "P2"); m.Body != "second, fixed" || m.EditCount != 1 {
		t.Fatalf("edit: %q %d", m.Body, m.EditCount)
	}
}

func TestCommunities(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	parent := types.NewJID("120363000000000010", types.GroupServer)
	sub := types.NewJID("120363000000000011", types.GroupServer)
	other := types.NewJID("120363000000000012", types.GroupServer)
	err := e.in.SyncGroups(ctx, []*types.GroupInfo{
		{JID: parent, GroupName: types.GroupName{Name: "Neighbours"}, GroupParent: types.GroupParent{IsParent: true}},
		{JID: sub, GroupName: types.GroupName{Name: "Announcements"}, GroupLinkedParent: types.GroupLinkedParent{LinkedParentJID: parent},
			GroupIsDefaultSub: types.GroupIsDefaultSub{IsDefaultSubGroup: true}},
		{JID: other, GroupName: types.GroupName{Name: "Garden"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	v := repo.View{}
	get := func(j types.JID) (c repo.ChatRow) {
		c, _ = repo.GetChat(ctx, e.db, j.String())
		return
	}
	if !get(parent).IsCommunity || get(sub).ParentJID != parent.String() || !get(sub).IsAnnounce {
		t.Fatalf("community not stored: %+v %+v", get(parent), get(sub))
	}
	dto, _ := v.Chat(ctx, e.db, get(sub))
	if dto.Community == nil || dto.Community.Name != "Neighbours" {
		t.Fatalf("community ref: %+v", dto.Community)
	}
	// Garden joins the community
	err = e.in.Handle(&events.GroupInfo{JID: parent, Timestamp: time.Now(),
		Link: &types.GroupLinkChange{Type: types.GroupLinkChangeTypeSub, Group: types.GroupLinkTarget{JID: other}}})
	if err != nil {
		t.Fatal(err)
	}
	if get(other).ParentJID != parent.String() {
		t.Fatal("link not applied")
	}
	err = e.in.Handle(&events.GroupInfo{JID: other, Timestamp: time.Now(),
		Unlink: &types.GroupLinkChange{Type: types.GroupLinkChangeTypeParent, Group: types.GroupLinkTarget{JID: parent}}})
	if err != nil {
		t.Fatal(err)
	}
	if get(other).ParentJID != "" {
		t.Fatal("unlink not applied")
	}
}
