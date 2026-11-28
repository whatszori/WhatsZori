package repo

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Channels (…@newsletter): one-way broadcasts. Their posts are messages like any other, with the
// server's id, a view count and reaction counts (WhatsApp doesn't say who reacted).

type ChannelMeta struct {
	JID         string
	Name        string
	Description string
	Followers   int
	Verified    bool
	// subscriber, admin, owner, guest; "" = we don't follow it (anymore)
	Role      string
	CreatedAt int64
}

func UpsertChannel(ctx context.Context, q DBTX, c ChannelMeta) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO chats (jid, is_group, name, description, followers, verified, channel_role, created_at, last_ts)
		VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET
			name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE chats.name END,
			description = excluded.description,
			followers = excluded.followers,
			verified = excluded.verified,
			channel_role = excluded.channel_role,
			created_at = excluded.created_at,
			last_ts = MAX(chats.last_ts, excluded.last_ts)`,
		c.JID, c.Name, c.Description, c.Followers, b2i(c.Verified), c.Role, c.CreatedAt, c.CreatedAt)
	return err
}

// SetChannelRole marks whether we follow a channel; its posts stay either way.
func SetChannelRole(ctx context.Context, q DBTX, jid, role string) error {
	_, err := q.ExecContext(ctx, `UPDATE chats SET channel_role = ? WHERE jid = ?`, role, jid)
	return err
}

// ChannelJIDs lists the channels we follow.
func ChannelJIDs(ctx context.Context, q DBTX) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT jid FROM chats WHERE jid LIKE '%@newsletter' AND channel_role <> '' ORDER BY last_ts DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// SetPostStats updates a channel post's views and reaction counts (by the server's id).
// Zero views or nil counts leave that part as it is (live updates carry one or the other).
func SetPostStats(ctx context.Context, q DBTX, chat string, serverID int64, views int, counts map[string]int) (int64, error) {
	var pk int64
	if err := q.QueryRowContext(ctx, `SELECT pk FROM messages WHERE chat_jid = ? AND server_id = ?`, chat, serverID).Scan(&pk); err != nil {
		return 0, err
	}
	if views > 0 {
		if _, err := q.ExecContext(ctx, `UPDATE messages SET views = MAX(views, ?) WHERE pk = ?`, views, pk); err != nil {
			return 0, err
		}
	}
	if counts != nil {
		b, _ := json.Marshal(counts)
		if _, err := q.ExecContext(ctx, `UPDATE messages SET reaction_counts = ? WHERE pk = ?`, string(b), pk); err != nil {
			return 0, err
		}
	}
	return pk, nil
}

// OldestServerID is the oldest post we have of a channel, for fetching the ones before it.
func OldestServerID(ctx context.Context, q DBTX, chat string) int64 {
	var id int64
	_ = q.QueryRowContext(ctx, `SELECT COALESCE(MIN(server_id), 0) FROM messages WHERE chat_jid = ? AND server_id > 0`, chat).Scan(&id)
	return id
}

// channelReactions turns a post's counts into the bubble's reactions; ours is marked mine (and
// counted, in case the server's numbers are from before we reacted).
func channelReactions(countsJSON, mine string) []domain.Reaction {
	counts := map[string]int{}
	_ = json.Unmarshal([]byte(countsJSON), &counts)
	if mine != "" && counts[mine] == 0 {
		counts[mine] = 1
	}
	out := make([]domain.Reaction, 0, len(counts))
	for e, n := range counts {
		if n > 0 {
			out = append(out, domain.Reaction{Emoji: e, Count: n, Mine: e == mine})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Emoji < out[j].Emoji
	})
	return out
}

// ChannelsLackingInfo lists channels known only from their posts: no name or no follower count.
func ChannelsLackingInfo(ctx context.Context, q DBTX) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT jid FROM chats WHERE jid LIKE '%@newsletter' AND (name = '' OR followers = 0) ORDER BY last_ts DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
