package wa_test

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

func (f *fakeClient) BuildPollVote(_ context.Context, poll *types.MessageInfo, options []string) (*waE2E.Message, error) {
	f.votedOn = poll
	return &waE2E.Message{PollUpdateMessage: &waE2E.PollUpdateMessage{}}, nil
}

func TestVote(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	err := e.in.Handle(&events.Message{
		Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: "P", Timestamp: time.Now()},
		Message: &waE2E.Message{PollCreationMessage: &waE2E.PollCreationMessage{
			Name:                   proto.String("When?"),
			Options:                []*waE2E.PollCreationMessage_Option{{OptionName: proto.String("Mon")}, {OptionName: proto.String("Tue")}},
			SelectableOptionsCount: proto.Uint32(1),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := repo.GetMessageByID(ctx, e.db, alice.String(), "P")
	if err := e.s.Vote(ctx, row.PK, []string{"Mon", "Tue"}); err == nil {
		t.Error("two choices on a single-choice poll")
	}
	if err := e.s.Vote(ctx, row.PK, []string{"Wed"}); err == nil {
		t.Error("an option that doesn't exist")
	}
	if err := e.s.Vote(ctx, row.PK, []string{"Tue"}); err != nil {
		t.Fatal(err)
	}
	if len(e.cli.sent) != 1 || e.cli.votedOn.ID != "P" || e.cli.votedOn.Sender != alice {
		t.Fatalf("sent %d, poll %+v", len(e.cli.sent), e.cli.votedOn)
	}
	votes, _ := repo.PollVotesFor(ctx, e.db, alice.String(), []string{"P"})
	if len(votes["P"]) != 1 || len(votes["P"][0].Options) != 1 {
		t.Errorf("own vote not stored: %+v", votes)
	}
}
