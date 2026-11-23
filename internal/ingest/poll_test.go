package ingest

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	evnames "github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// the test "encryption": the vote travels as plain protobuf in EncPayload
func (f *fakeClient) DecryptPollVote(_ context.Context, e *events.Message) (*waE2E.PollVoteMessage, error) {
	var v waE2E.PollVoteMessage
	err := proto.Unmarshal(e.Message.GetPollUpdateMessage().GetVote().GetEncPayload(), &v)
	return &v, err
}

func voteEvt(chat, voter types.JID, pollID string, options ...string) *events.Message {
	at := tick()
	plain, _ := proto.Marshal(&waE2E.PollVoteMessage{SelectedOptions: whatsmeow.HashPollOptions(options)})
	return &events.Message{Info: info(chat, voter, "V-"+at.String()), Message: &waE2E.Message{
		PollUpdateMessage: &waE2E.PollUpdateMessage{
			PollCreationMessageKey: &waCommon.MessageKey{ID: proto.String(pollID), RemoteJID: proto.String(chat.String())},
			Vote:                   &waE2E.PollEncValue{EncPayload: plain},
			SenderTimestampMS:      proto.Int64(at.UnixMilli()),
		},
	}}
}

func TestPollVotes(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.handle(t, &events.Message{Info: info(group, alice, "POLL"), Message: &waE2E.Message{
		PollCreationMessageV3: &waE2E.PollCreationMessage{
			Name:                   proto.String("Pizza?"),
			Options:                []*waE2E.PollCreationMessage_Option{{OptionName: proto.String("Yes")}, {OptionName: proto.String("No")}},
			SelectableOptionsCount: proto.Uint32(1),
		},
	}})
	poll := func() *domain.PollInfo {
		t.Helper()
		row := e.msg(t, group, "POLL")
		m, err := repo.View{Me: me.String()}.Message(ctx, e.db, row.PK)
		if err != nil || m.Poll == nil || m.Kind != domain.KindPoll {
			t.Fatalf("poll message: %+v %v", m, err)
		}
		return m.Poll
	}
	if p := poll(); p.Name != "Pizza?" || len(p.Options) != 2 || p.Selectable != 1 || p.TotalVoters != 0 {
		t.Fatalf("fresh poll: %+v", p)
	}

	e.rec.take(evnames.MsgBatch)
	e.handle(t, voteEvt(group, bob, "POLL", "Yes"))
	if len(e.rec.take(evnames.MsgBatch)) == 0 {
		t.Error("a vote should send the poll again")
	}
	e.handle(t, voteEvt(group, alice, "POLL", "No"))
	e.handle(t, voteEvt(group, bob, "POLL", "No")) // bob changes his mind
	p := poll()
	if p.TotalVoters != 2 || p.Options[0].Votes != 0 || p.Options[1].Votes != 2 {
		t.Fatalf("after votes: %+v", p)
	}

	if err := e.in.ApplyLocalVote(ctx, group.String(), "POLL", whatsmeow.HashPollOptions([]string{"Yes"}), tick().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	p = poll()
	if !p.Options[0].Mine || p.Options[0].Voters[0] != "You" || p.TotalVoters != 3 {
		t.Fatalf("own vote: %+v", p)
	}
	// taking it back
	e.handle(t, voteEvt(group, alice, "POLL"))
	if p = poll(); p.TotalVoters != 2 || p.Options[1].Votes != 1 {
		t.Fatalf("retracted: %+v", p)
	}
}
