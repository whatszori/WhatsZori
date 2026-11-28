package ingest

import (
	"context"
	"database/sql"
	"errors"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Channels: their info from WhatsApp, and posts fetched in pages (live ones come as ordinary
// messages, handled by message()).

func (in *Ingester) channel(ctx context.Context, tx *sql.Tx, fx *effects, n *types.NewsletterMetadata) error {
	role := "subscriber"
	if n.ViewerMeta != nil && n.ViewerMeta.Role != "" {
		role = string(n.ViewerMeta.Role)
	}
	t := n.ThreadMeta
	jid := n.ID.String()
	fx.chats[jid] = true
	return repo.UpsertChannel(ctx, tx, repo.ChannelMeta{
		JID: jid, Name: t.Name.Text, Description: t.Description.Text, Followers: t.SubscriberCount,
		Verified: t.VerificationState == types.NewsletterVerificationStateVerified, Role: role,
		CreatedAt: ms(t.CreationTime.Time),
	})
}

// SyncChannelOne stores one channel (just followed).
func (in *Ingester) SyncChannelOne(ctx context.Context, n *types.NewsletterMetadata) error {
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.channel(ctx, tx, fx, n) })
}

// SyncChannels stores the channels we follow; ones we no longer follow keep their posts.
func (in *Ingester) SyncChannels(ctx context.Context, list []*types.NewsletterMetadata) error {
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		following := map[string]bool{}
		for _, n := range list {
			following[n.ID.String()] = true
			if err := in.channel(ctx, tx, fx, n); err != nil {
				return err
			}
		}
		known, err := repo.ChannelJIDs(ctx, tx)
		if err != nil {
			return err
		}
		for _, j := range known {
			if !following[j] {
				fx.chats[j] = true
				if err := repo.SetChannelRole(ctx, tx, j, ""); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// ChannelPosts stores fetched posts (and refreshes views and reactions of ones we have).
func (in *Ingester) ChannelPosts(ctx context.Context, chat types.JID, posts []*types.NewsletterMessage) error {
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		for _, p := range posts {
			if p.Message == nil {
				continue
			}
			evt := &events.Message{
				Info: types.MessageInfo{
					MessageSource: types.MessageSource{Chat: chat, Sender: chat},
					ID:            p.MessageID, ServerID: p.MessageServerID, Timestamp: p.Timestamp, Type: p.Type,
				},
				RawMessage: p.Message,
			}
			evt.UnwrapRaw()
			if err := in.message(ctx, tx, fx, evt, false); err != nil {
				return err
			}
		}
		return in.channelStats(ctx, tx, fx, chat.String(), posts)
	})
}

func (in *Ingester) channelStats(ctx context.Context, tx *sql.Tx, fx *effects, chat string, posts []*types.NewsletterMessage) error {
	for _, p := range posts {
		pk, err := repo.SetPostStats(ctx, tx, chat, int64(p.MessageServerID), p.ViewsCount, p.ReactionCounts)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		} else if err != nil {
			return err
		}
		fx.msgs = append(fx.msgs, pk)
		fx.chats[chat] = true
	}
	return nil
}
