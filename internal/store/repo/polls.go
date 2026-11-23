package repo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// SetPollVote stores someone's vote unless we already have a newer one from them. options are
// the raw option hashes; none means they took their vote back.
func SetPollVote(ctx context.Context, q DBTX, chat, pollID, voter string, options [][]byte, ts int64) error {
	hexes := make([]string, len(options))
	for i, o := range options {
		hexes[i] = hex.EncodeToString(o)
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO poll_votes (chat_jid, poll_id, voter_jid, options, ts) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (chat_jid, poll_id, voter_jid) DO UPDATE SET options = excluded.options, ts = excluded.ts
		WHERE excluded.ts >= poll_votes.ts`,
		chat, pollID, voter, strings.Join(hexes, ","), ts)
	return err
}

type PollVote struct {
	Voter   string
	Options []string // hex hashes
}

func PollVotesFor(ctx context.Context, q DBTX, chat string, ids []string) (map[string][]PollVote, error) {
	out := map[string][]PollVote{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, `
		SELECT poll_id, voter_jid, options FROM poll_votes
		WHERE chat_jid = ? AND poll_id IN (`+placeholders(len(ids))+`) ORDER BY ts`,
		append([]any{chat}, anys(ids)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, voter, opts string
		if err := rows.Scan(&id, &voter, &opts); err != nil {
			return nil, err
		}
		v := PollVote{Voter: voter}
		if opts != "" {
			v.Options = strings.Split(opts, ",")
		}
		out[id] = append(out[id], v)
	}
	return out, rows.Err()
}

// PollOf reads a poll's question, options and how many may be picked from the stored message.
func PollOf(raw []byte) (*waE2E.PollCreationMessage, bool) {
	if raw == nil {
		return nil, false
	}
	var msg waE2E.Message
	if proto.Unmarshal(raw, &msg) != nil {
		return nil, false
	}
	for _, p := range []*waE2E.PollCreationMessage{msg.GetPollCreationMessage(), msg.GetPollCreationMessageV2(), msg.GetPollCreationMessageV3()} {
		if p != nil {
			return p, true
		}
	}
	return nil, false
}

func optionHash(name string) string {
	h := sha256.Sum256([]byte(name))
	return hex.EncodeToString(h[:])
}

// pollInfo puts the poll and its votes together for the UI.
func pollInfo(p *waE2E.PollCreationMessage, votes []PollVote, me string, name func(jid string) string) *domain.PollInfo {
	info := &domain.PollInfo{Name: p.GetName(), Selectable: int(p.GetSelectableOptionsCount())}
	index := map[string]int{}
	for i, o := range p.GetOptions() {
		index[optionHash(o.GetOptionName())] = i
		info.Options = append(info.Options, domain.PollOption{Name: o.GetOptionName(), Voters: []string{}})
	}
	for _, v := range votes {
		if len(v.Options) == 0 {
			continue
		}
		info.TotalVoters++
		for _, h := range v.Options {
			i, ok := index[h]
			if !ok {
				continue
			}
			o := &info.Options[i]
			o.Votes++
			if v.Voter == me {
				o.Mine = true
				o.Voters = append(o.Voters, "You")
			} else {
				o.Voters = append(o.Voters, name(v.Voter))
			}
		}
	}
	return info
}
