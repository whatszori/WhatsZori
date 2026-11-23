package ingest

import (
	"context"
	"database/sql"
	"fmt"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/whatszori/WhatsZori/internal/domain"
	evnames "github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// HistorySync stores one blob of history from the phone. Each conversation is its own
// transaction, so a bad one doesn't throw away the rest of the blob.
func (in *Ingester) HistorySync(ctx context.Context, e *events.HistorySync) error {
	data := e.Data
	if data == nil {
		return nil
	}
	cli := in.cli()
	fx := newEffects()

	if err := store.InTx(ctx, in.db, func(tx *sql.Tx) error {
		for _, m := range data.GetPhoneNumberToLidMappings() {
			pn, err1 := types.ParseJID(m.GetPnJID())
			lid, err2 := types.ParseJID(m.GetLidJID())
			if err1 == nil && err2 == nil {
				in.learn(ctx, tx, fx, lid, pn)
			}
		}
		now := ms(in.now())
		for _, p := range data.GetPushnames() {
			j, err := types.ParseJID(p.GetID())
			if err != nil || p.GetPushname() == "" {
				continue
			}
			if err := repo.SetPushName(ctx, tx, in.jids.Key(ctx, j), p.GetPushname(), now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	for _, conv := range data.GetConversations() {
		err := store.InTx(ctx, in.db, func(tx *sql.Tx) error {
			return in.conversation(ctx, tx, fx, cli, data.GetSyncType(), conv)
		})
		if err != nil {
			// log and go on: one broken conversation shouldn't cost the rest of the blob
			in.log.Error("history conversation", "chat", redact.JID(conv.GetID()), "error", err)
		}
	}
	in.flush(ctx, fx)
	if data.Progress != nil {
		p := int(data.GetProgress())
		in.emit.Emit(evnames.SyncProgress, domain.SyncProgressEvent{Progress: p, Done: p >= 100})
	}
	return nil
}

type webParser interface {
	ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error)
}

func (in *Ingester) conversation(ctx context.Context, tx *sql.Tx, fx *effects, cli webParser, syncType waHistorySync.HistorySync_HistorySyncType, conv *waHistorySync.Conversation) error {
	chatJID, err := types.ParseJID(conv.GetID())
	if err != nil {
		return fmt.Errorf("conversation id: %w", err)
	}
	if skipChat(chatJID) {
		return nil
	}
	for _, alt := range []string{conv.GetPnJID(), conv.GetLidJID()} {
		if j, err := types.ParseJID(alt); err == nil && alt != "" {
			in.learn(ctx, tx, fx, chatJID, j)
		}
	}
	isGroup := chatJID.Server == types.GroupServer
	chat := in.jids.Key(ctx, chatJID)
	if err := in.ensureChat(ctx, tx, fx, chat, isGroup); err != nil {
		return err
	}
	if isGroup && conv.GetName() != "" {
		if err := repo.SetChatName(ctx, tx, chat, conv.GetName()); err != nil {
			return err
		}
	}
	if isGroup && conv.GetDescription() != "" {
		if err := repo.SetGroupDescription(ctx, tx, chat, conv.GetDescription()); err != nil {
			return err
		}
	}
	// flags and unread counts come with the initial and full syncs; later on-demand chunks
	// would otherwise reset what app state sync already set
	if syncType == waHistorySync.HistorySync_INITIAL_BOOTSTRAP || syncType == waHistorySync.HistorySync_FULL || syncType == waHistorySync.HistorySync_RECENT {
		if conv.Pinned != nil {
			if err := repo.SetPinned(ctx, tx, chat, conv.GetPinned() > 0); err != nil {
				return err
			}
		}
		if conv.Archived != nil {
			if err := repo.SetArchived(ctx, tx, chat, conv.GetArchived()); err != nil {
				return err
			}
		}
		if conv.MuteEndTime != nil {
			end := int64(conv.GetMuteEndTime())
			if end > 0 && end < 1e12 {
				end *= 1000
			}
			if err := repo.SetMutedUntil(ctx, tx, chat, muteUntil(end != 0, end)); err != nil {
				return err
			}
		}
		unread := int(conv.GetUnreadCount())
		if unread == 0 && conv.GetMarkedAsUnread() {
			unread = 1
		}
		if conv.UnreadCount != nil || conv.MarkedAsUnread != nil {
			if err := repo.SetUnread(ctx, tx, chat, unread); err != nil {
				return err
			}
		}
	}
	if ts := int64(conv.GetConversationTimestamp()); ts > 0 {
		if err := repo.BumpLastTS(ctx, tx, chat, ts*1000); err != nil {
			return err
		}
	}
	fx.chats[chat] = true

	if cli == nil {
		return nil
	}
	me := in.Me(ctx)
	for _, hm := range conv.GetMessages() {
		web := hm.GetMessage()
		if web == nil {
			continue
		}
		if isGroup {
			if handled, err := in.historyStub(ctx, tx, chat, web); err != nil {
				return err
			} else if handled {
				continue
			}
		}
		if web.GetMessageStubType() == waWeb.WebMessageInfo_REVOKE && web.GetMessage() == nil {
			// deleted before we were linked; all we know is that it existed
			sender := chat
			if web.GetKey().GetFromMe() {
				sender = me
			} else if p := firstNonEmpty(web.GetParticipant(), web.GetKey().GetParticipant()); p != "" {
				if j, err := types.ParseJID(p); err == nil {
					sender = in.jids.Key(ctx, j)
				}
			}
			ts := int64(web.GetMessageTimestamp()) * 1000
			if err := in.revoke(ctx, tx, fx, chat, isGroup, web.GetKey(), sender, types.EditAttributeSenderRevoke, ts, me); err != nil {
				return err
			}
			continue
		}
		evt, err := cli.ParseWebMessage(chatJID, web)
		if err != nil {
			in.log.Warn("parse history message", "id", web.GetKey().GetID(), "error", redact.Digits(err.Error()))
			continue
		}
		if err := in.message(ctx, tx, fx, evt, false); err != nil {
			return err
		}
	}
	return nil
}
