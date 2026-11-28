package wa

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Channels: following, unfollowing, reacting, and fetching posts. Posts are only read here; we
// don't send "viewed" for them (it's a read signal, and ghost mode would have to say no anyway).

var ErrNotChannel = errors.New("not a channel")

// ChannelSync is what fetching posts needs from the ingester.
type ChannelSync interface {
	SyncChannels(ctx context.Context, list []*types.NewsletterMetadata) error
	ChannelPosts(ctx context.Context, chat types.JID, posts []*types.NewsletterMessage) error
	SyncChannelOne(ctx context.Context, n *types.NewsletterMetadata) error
	ChannelInfo(ctx context.Context, n *types.NewsletterMetadata) error
}

// ChannelsLacking lists channels we know only from their posts (no name or follower count yet).
type ChannelsLacking func(ctx context.Context) ([]string, error)

func channelJID(jid string) (types.JID, error) {
	j, err := types.ParseJID(jid)
	if err != nil || j.Server != types.NewsletterServer {
		return types.EmptyJID, ErrNotChannel
	}
	return j, nil
}

func (s *Sender) reactToPost(ctx context.Context, m repo.MessageRow, emoji string) ([]domain.Reaction, error) {
	if m.ServerID == 0 {
		return nil, errors.New("this post can't take reactions")
	}
	j, err := channelJID(m.ChatJID)
	if err != nil {
		return nil, err
	}
	me := s.Local.Me(ctx)
	if cur, err := repo.MyReaction(ctx, s.DB, m.ChatJID, m.MsgID, me); err == nil && cur == emoji {
		emoji = ""
	}
	cli, err := s.Ready()
	if err != nil {
		return nil, err
	}
	if err := cli.NewsletterSendReaction(ctx, j, types.MessageServerID(m.ServerID), emoji, cli.GenerateMessageID()); err != nil {
		return nil, fmt.Errorf("reaction not sent: %s", sendErrorText(err))
	}
	if err := s.Local.ApplyLocalReaction(ctx, m.ChatJID, m.MsgID, emoji, s.now().UnixMilli()); err != nil {
		return nil, err
	}
	dto, err := s.view(ctx).Message(ctx, s.DB, m.PK)
	if err != nil {
		return nil, err
	}
	return dto.Reactions, nil
}

// SyncChannels stores the channels we follow and their newest posts.
func SyncChannels(ctx context.Context, cli Client, in ChannelSync, perChannel int, lacking ChannelsLacking) error {
	list, err := cli.GetSubscribedNewsletters(ctx)
	if err != nil {
		return err
	}
	if err := in.SyncChannels(ctx, list); err != nil {
		return err
	}
	for _, n := range list {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		posts, err := cli.GetNewsletterPosts(ctx, n.ID, perChannel, 0)
		if err != nil {
			continue // one channel failing doesn't stop the rest
		}
		if err := in.ChannelPosts(ctx, n.ID, posts); err != nil {
			return err
		}
	}
	// channels that came with history or a forwarded post: their info, one by one
	if lacking != nil {
		jids, err := lacking(ctx)
		if err != nil {
			return err
		}
		for _, j := range jids {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			pj, err := channelJID(j)
			if err != nil {
				continue
			}
			if info, err := cli.GetNewsletterInfo(ctx, pj); err == nil {
				if err := in.ChannelInfo(ctx, info); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// RefreshChannel fetches a channel's newest posts (or, older, the page before the oldest we
// have) and asks for live updates while it's open.
func RefreshChannel(ctx context.Context, cli Client, in ChannelSync, db repo.DBTX, jid string, older bool) (bool, error) {
	j, err := channelJID(jid)
	if err != nil {
		return false, err
	}
	var before types.MessageServerID
	if older {
		before = types.MessageServerID(repo.OldestServerID(ctx, db, jid))
	}
	if !older {
		// fresh name, followers and picture each time it's opened
		if info, err := cli.GetNewsletterInfo(ctx, j); err == nil {
			_ = in.ChannelInfo(ctx, info)
		}
	}
	posts, err := cli.GetNewsletterPosts(ctx, j, 50, before)
	if err != nil {
		return false, fmt.Errorf("couldn't get the channel's posts: %w", err)
	}
	if err := in.ChannelPosts(ctx, j, posts); err != nil {
		return false, err
	}
	if !older {
		// live updates (views, reactions, new posts) for a few minutes; asked again on the next open
		_, _ = cli.NewsletterSubscribeLiveUpdates(ctx, j)
	}
	return len(posts) > 0, nil
}

// InviteKey takes a channel link (whatsapp.com/channel/<key>) or the bare key.
func InviteKey(link string) (string, error) {
	link = strings.TrimSpace(link)
	if link == "" {
		return "", errors.New("paste a channel link")
	}
	if !strings.Contains(link, "/") {
		return link, nil
	}
	if !strings.Contains(link, "://") {
		link = "https://" + link
	}
	u, err := url.Parse(link)
	if err != nil {
		return "", errors.New("that isn't a link")
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if (host != "whatsapp.com" && host != "wa.me") || len(parts) != 2 || parts[0] != "channel" || parts[1] == "" {
		return "", errors.New("that isn't a WhatsApp channel link (whatsapp.com/channel/…)")
	}
	return parts[1], nil
}

// FollowChannel follows a channel by its link and fetches its posts; it returns the channel's JID.
func FollowChannel(ctx context.Context, cli Client, in ChannelSync, link string) (string, error) {
	var info *types.NewsletterMetadata
	if j, err := channelJID(link); err == nil {
		// one we followed before
		info, err = cli.GetNewsletterInfo(ctx, j)
		if err != nil {
			return "", fmt.Errorf("couldn't find that channel: %w", err)
		}
	} else {
		key, err := InviteKey(link)
		if err != nil {
			return "", err
		}
		if info, err = cli.GetNewsletterInfoWithInvite(ctx, key); err != nil {
			return "", fmt.Errorf("couldn't find that channel: %w", err)
		}
	}
	if err := cli.FollowNewsletter(ctx, info.ID); err != nil {
		return "", fmt.Errorf("couldn't follow: %w", err)
	}
	if info.ViewerMeta == nil {
		info.ViewerMeta = &types.NewsletterViewerMetadata{}
	}
	if info.ViewerMeta.Role == "" {
		info.ViewerMeta.Role = types.NewsletterRoleSubscriber
	}
	if err := in.SyncChannelOne(ctx, info); err != nil {
		return "", err
	}
	if posts, err := cli.GetNewsletterPosts(ctx, info.ID, 50, 0); err == nil {
		_ = in.ChannelPosts(ctx, info.ID, posts)
	}
	return info.ID.String(), nil
}
