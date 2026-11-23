package wa

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

var ErrNotPoll = errors.New("not a poll")

// Vote sets our vote on a poll to options (option names; none takes the vote back), like tapping
// them on the phone. Sent right away, then recorded locally.
func (s *Sender) Vote(ctx context.Context, pk int64, options []string) error {
	m, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return err
	}
	p, ok := repo.PollOf(m.Raw)
	if m.Kind != repo.KindPoll || !ok || m.IsDeleted {
		return ErrNotPoll
	}
	names := make([]string, 0, len(p.GetOptions()))
	for _, o := range p.GetOptions() {
		names = append(names, o.GetOptionName())
	}
	for _, o := range options {
		if !slices.Contains(names, o) {
			return fmt.Errorf("%q isn't an option of this poll", o)
		}
	}
	if max := int(p.GetSelectableOptionsCount()); max > 0 && len(options) > max {
		return fmt.Errorf("this poll allows %d choice(s)", max)
	}
	cli, jid, err := s.prepare(ctx, m.ChatJID, "")
	if err != nil {
		return err
	}
	sender, err := types.ParseJID(m.SenderJID)
	if err != nil {
		return fmt.Errorf("poll author: %w", err)
	}
	if m.FromMe {
		sender = cli.OwnID().ToNonAD()
	}
	info := &types.MessageInfo{
		MessageSource: types.MessageSource{Chat: jid, Sender: sender, IsFromMe: m.FromMe, IsGroup: jid.Server == types.GroupServer},
		ID:            m.MsgID,
	}
	msg, err := cli.BuildPollVote(ctx, info, options)
	if err != nil {
		return fmt.Errorf("couldn't prepare the vote: %w", err)
	}
	if _, err := cli.SendMessage(ctx, jid, msg, ""); err != nil {
		return fmt.Errorf("vote not sent: %s", sendErrorText(err))
	}
	return s.Local.ApplyLocalVote(ctx, m.ChatJID, m.MsgID, whatsmeow.HashPollOptions(options), s.now().UnixMilli())
}
