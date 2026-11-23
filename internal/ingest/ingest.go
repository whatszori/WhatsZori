// Package ingest turns whatsmeow events into rows in whatszori.db and events for the frontend.
// Writes happen synchronously in the event handler (whatsmeow acks after it returns); frontend
// events go out afterwards through the batching emitter.
package ingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	evnames "github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

// Media is the downloader, as far as ingest cares: queue an auto-download, delete a purged file.
type Media interface {
	Enqueue(pk int64)
	Remove(rel string)
}

// Notifier gets new live incoming messages (for desktop notifications) and hears about the
// offline backlog, so a reconnect doesn't turn into a hundred toasts.
type Notifier interface {
	Incoming(m domain.Message, chat domain.Chat)
	OfflineStart()
	OfflineDone()
}

// Avatars is the profile picture cache; a Picture event makes it refetch.
type Avatars interface {
	Invalidate(ctx context.Context, jid string)
}

type Options struct {
	DB     *sql.DB
	JIDs   *wa.JIDs
	Emit   evnames.Emitter
	Policy func() domain.HistoryPolicy
	// Client is the current whatsmeow client (it changes after a re-login). Used for our own JID,
	// parsing history sync messages and fetching group info.
	Client  func() wa.Client
	Media   Media
	Avatars Avatars
	Notify  Notifier
	Log     *slog.Logger
	Now     func() time.Time
}

type Ingester struct {
	db      *sql.DB
	jids    *wa.JIDs
	emit    evnames.Emitter
	policy  func() domain.HistoryPolicy
	client  func() wa.Client
	media   Media
	avatars Avatars
	notify  Notifier
	log     *slog.Logger
	now     func() time.Time

	groupsMu      sync.Mutex
	groupsFetched map[string]bool
}

func New(o Options) *Ingester {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Policy == nil {
		o.Policy = func() domain.HistoryPolicy { return domain.History{}.Policy() }
	}
	return &Ingester{db: o.DB, jids: o.JIDs, emit: o.Emit, policy: o.Policy, client: o.Client, media: o.Media, avatars: o.Avatars, notify: o.Notify,
		log: o.Log, now: o.Now, groupsFetched: map[string]bool{}}
}

// effects collects what to tell the frontend once the transaction committed.
type effects struct {
	msgs      []int64
	chats     map[string]bool
	removed   []string
	events    []namedEvent
	downloads []int64
	// new live incoming messages, for notifications
	notify []int64
	files  []string
	groups []types.JID
}

type namedEvent struct {
	name string
	data any
}

func newEffects() *effects { return &effects{chats: map[string]bool{}} }

func (fx *effects) event(name string, data any) {
	fx.events = append(fx.events, namedEvent{name, data})
}

func (in *Ingester) cli() wa.Client {
	if in.client == nil {
		return nil
	}
	return in.client()
}

// Me is our canonical JID, or "" before login.
func (in *Ingester) Me(ctx context.Context) string {
	c := in.cli()
	if c == nil || c.OwnID().IsEmpty() {
		return ""
	}
	return in.jids.Key(ctx, c.OwnID())
}

func (in *Ingester) view(ctx context.Context) repo.View { return repo.View{Me: in.Me(ctx)} }

func ms(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// Handle is the whatsmeow event hook. An error means "don't ack", so the server redelivers.
func (in *Ingester) Handle(evt any) error {
	ctx := context.Background()
	switch e := evt.(type) {
	case *events.Message:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.message(ctx, tx, fx, e, true) })
	case *events.Receipt:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.receipt(ctx, tx, fx, e) })
	case *events.HistorySync:
		return in.HistorySync(ctx, e)
	case *events.Presence:
		in.presence(ctx, e)
	case *events.ChatPresence:
		in.chatPresence(ctx, e)
	case *events.PushName:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
			if !e.JIDAlt.IsEmpty() {
				in.learn(ctx, tx, fx, e.JID, e.JIDAlt)
			}
			jid := in.jids.Key(ctx, e.JID)
			fx.chats[jid] = true
			return repo.SetPushName(ctx, tx, jid, e.NewPushName, ms(in.now()))
		})
	case *events.BusinessName:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
			jid := in.jids.Key(ctx, e.JID)
			fx.chats[jid] = true
			return repo.SetBusinessName(ctx, tx, jid, e.NewBusinessName, ms(in.now()))
		})
	case *events.Contact:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.contact(ctx, tx, fx, e) })
	case *events.UserAbout:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
			return repo.SetAbout(ctx, tx, in.jids.Key(ctx, e.JID), e.Status, ms(in.now()))
		})
	case *events.GroupInfo:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.groupChange(ctx, tx, fx, e) })
	case *events.JoinedGroup:
		return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
			if err := in.UpsertGroup(ctx, tx, fx, &e.GroupInfo); err != nil {
				return err
			}
			// we were added (or joined by link)
			kind, actor := repo.GroupAdd, ""
			if e.Sender != nil {
				actor = in.jids.Key(ctx, *e.Sender)
			}
			if e.Reason == "invite" || actor == "" {
				kind = repo.GroupJoin
			}
			return repo.AddGroupEvent(ctx, tx, e.JID.String(), repo.GroupEvent{TS: ms(in.now()), Kind: kind, Actor: actor, Target: in.Me(ctx)})
		})
	case *events.Pin:
		return in.chatFlag(ctx, e.JID, func(tx *sql.Tx, jid string) error {
			return repo.SetPinned(ctx, tx, jid, e.Action.GetPinned())
		})
	case *events.Archive:
		return in.chatFlag(ctx, e.JID, func(tx *sql.Tx, jid string) error {
			return repo.SetArchived(ctx, tx, jid, e.Action.GetArchived())
		})
	case *events.Mute:
		return in.chatFlag(ctx, e.JID, func(tx *sql.Tx, jid string) error {
			return repo.SetMutedUntil(ctx, tx, jid, muteUntil(e.Action.GetMuted(), e.Action.GetMuteEndTimestamp()))
		})
	case *events.MarkChatAsRead:
		return in.chatFlag(ctx, e.JID, func(tx *sql.Tx, jid string) error {
			if e.Action.GetRead() {
				return repo.SetUnread(ctx, tx, jid, 0)
			}
			// "mark as unread" on the phone; show it as one unread message, like the phone does
			return repo.SetUnread(ctx, tx, jid, 1)
		})
	case *events.Picture:
		jid := in.jids.Key(ctx, e.JID)
		if in.avatars != nil {
			in.avatars.Invalidate(ctx, jid)
		}
		in.emit.Emit(evnames.AvatarChange, domain.AvatarChangedEvent{JID: jid})
	case *events.OfflineSyncPreview:
		if in.notify != nil && e.Messages > 0 {
			in.notify.OfflineStart()
		}
	case *events.OfflineSyncCompleted:
		if in.notify != nil {
			in.notify.OfflineDone()
		}
	case *events.UndecryptableMessage:
		// whatsmeow already asked the sender to retry; a readable copy arrives as a normal message
		in.log.Info("undecryptable message", "id", e.Info.ID, "unavailable", e.IsUnavailable)
	}
	return nil
}

// run does fn in a transaction and sends the frontend events after commit.
func (in *Ingester) run(ctx context.Context, fn func(tx *sql.Tx, fx *effects) error) error {
	fx := newEffects()
	if err := store.InTx(ctx, in.db, func(tx *sql.Tx) error { return fn(tx, fx) }); err != nil {
		return err
	}
	in.flush(ctx, fx)
	return nil
}

func (in *Ingester) flush(ctx context.Context, fx *effects) {
	v := in.view(ctx)
	for _, jid := range fx.removed {
		in.emit.Emit(evnames.ChatRemoved, domain.ChatRemovedEvent{JID: jid})
	}
	if len(fx.msgs) > 0 {
		rows, err := repo.MessagesByPKs(ctx, in.db, fx.msgs)
		if err == nil {
			// a chunk at a time so one huge history batch doesn't build one giant event
			notify := map[string]bool{}
			for _, pk := range fx.notify {
				notify[strconv.FormatInt(pk, 10)] = true
			}
			for i := 0; i < len(rows); i += 200 {
				part := rows[i:min(i+200, len(rows))]
				if dtos, err := v.Messages(ctx, in.db, part); err == nil {
					in.emit.Emit(evnames.MsgBatch, domain.MsgBatchEvent{Messages: dtos})
					if in.notify != nil {
						for _, m := range dtos {
							if notify[m.PK] {
								in.notifyOne(ctx, v, m)
							}
						}
					}
				} else {
					in.log.Error("build messages", "error", err)
				}
			}
		} else {
			in.log.Error("load messages", "error", err)
		}
	}
	for _, e := range fx.events {
		in.emit.Emit(e.name, e.data)
	}
	for jid := range fx.chats {
		c, err := repo.GetChat(ctx, in.db, jid)
		if err != nil {
			continue
		}
		dto, err := v.Chat(ctx, in.db, c)
		if err != nil {
			in.log.Error("build chat", "error", err)
			continue
		}
		if dto.IsGroup || dto.LastMessage != nil {
			in.emit.Emit(evnames.ChatUpdate, domain.ChatUpdateEvent{Chat: dto})
		}
	}
	if in.media != nil {
		for _, rel := range fx.files {
			in.media.Remove(rel)
		}
		for _, pk := range fx.downloads {
			in.media.Enqueue(pk)
		}
	}
	for _, g := range fx.groups {
		go in.fetchGroup(g)
	}
}

func (in *Ingester) chatFlag(ctx context.Context, jid types.JID, fn func(tx *sql.Tx, jid string) error) error {
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		key := in.jids.Key(ctx, jid)
		if err := repo.EnsureChat(ctx, tx, key, jid.Server == types.GroupServer); err != nil {
			return err
		}
		fx.chats[key] = true
		return fn(tx, key)
	})
}

func muteUntil(muted bool, endMS int64) int64 {
	if !muted {
		return 0
	}
	// WA uses -1 (or a far-future timestamp) for "always"
	if endMS <= 0 || endMS > 253370764800000 {
		return -1
	}
	return endMS
}

// learn handles a LID <-> phone number pair. A new mapping folds the LID chat and contact into the
// phone-number ones.
func (in *Ingester) learn(ctx context.Context, tx *sql.Tx, fx *effects, a, b types.JID) {
	lid, pn, isNew := in.jids.Learn(ctx, a, b)
	if lid.IsEmpty() {
		return
	}
	l, p := lid.String(), pn.String()
	if err := repo.LinkLID(ctx, tx, p, l, ms(in.now())); err != nil {
		in.log.Error("link lid", "error", err)
	}
	if !isNew {
		return
	}
	if _, err := repo.GetChat(ctx, tx, l); err == nil {
		if err := repo.MergeChat(ctx, tx, l, p); err != nil {
			in.log.Error("merge lid chat", "error", err)
			return
		}
		fx.removed = append(fx.removed, l)
		fx.chats[p] = true
	}
}

func (in *Ingester) learnSource(ctx context.Context, tx *sql.Tx, fx *effects, src types.MessageSource) {
	if !src.SenderAlt.IsEmpty() {
		in.learn(ctx, tx, fx, src.Sender, src.SenderAlt)
	}
	if !src.RecipientAlt.IsEmpty() && !src.IsGroup {
		in.learn(ctx, tx, fx, src.Chat, src.RecipientAlt)
	}
}

func skipChat(j types.JID) bool {
	switch j.Server {
	case types.BroadcastServer, types.NewsletterServer:
		// status updates and channels aren't part of this client yet
		return true
	}
	return false
}

// message handles one events.Message, live or from history sync.
func (in *Ingester) message(ctx context.Context, tx *sql.Tx, fx *effects, e *events.Message, live bool) error {
	info := e.Info
	if skipChat(info.Chat) || e.Message == nil {
		return nil
	}
	in.learnSource(ctx, tx, fx, info.MessageSource)
	chat := in.jids.Key(ctx, info.Chat)
	sender := in.jids.Key(ctx, info.Sender)
	me := in.Me(ctx)
	if info.IsFromMe && me != "" {
		sender = me
	}
	msg := e.Message
	ts := ms(info.Timestamp)

	if pm := msg.GetProtocolMessage(); pm != nil {
		switch pm.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			return in.revoke(ctx, tx, fx, chat, info.IsGroup, pm.GetKey(), sender, info.Edit, ts, me)
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			at := pm.GetTimestampMS()
			if at == 0 {
				at = ts
			}
			return in.edit(ctx, tx, fx, chat, pm.GetKey().GetID(), sender, info.IsFromMe, pm.GetEditedMessage(), at)
		}
		return nil
	}
	if e.IsEdit {
		// history sync hands edits over already unwrapped: the original id with the new content
		return in.edit(ctx, tx, fx, chat, info.ID, sender, info.IsFromMe, msg, ts)
	}
	if r := msg.GetReactionMessage(); r != nil {
		rts := r.GetSenderTimestampMS()
		if rts == 0 {
			rts = ts
		}
		return in.reaction(ctx, tx, fx, chat, r.GetKey().GetID(), sender, r.GetText(), rts)
	}
	if isControl(msg) || isMetaOnly(msg) {
		return nil
	}

	c := extract(msg)
	raw, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}
	row := &repo.MessageRow{
		ChatJID: chat, MsgID: info.ID, SenderJID: sender, FromMe: info.IsFromMe, PushName: info.PushName, TS: ts,
		Kind: c.kind, Body: c.body, IsEphemeral: e.IsEphemeral, IsViewOnce: e.IsViewOnce, Raw: raw,
		// history is old news: no read receipts for it later, whatever the ghost mode
		ReadSent: !live || info.IsFromMe,
	}
	if c.quotedID != "" {
		row.QuotedID = c.quotedID
		if c.quotedSender != "" {
			if j, err := types.ParseJID(c.quotedSender); err == nil {
				row.QuotedSender = in.jids.Key(ctx, j)
			}
		}
	}
	if info.IsFromMe {
		row.Status = string(domain.StatusSent)
		if e.SourceWebMsg != nil {
			row.Status = webStatus(e.SourceWebMsg.GetStatus())
		}
	}

	if err := in.ensureChat(ctx, tx, fx, chat, info.IsGroup); err != nil {
		return err
	}
	if !info.IsFromMe && info.PushName != "" {
		if err := repo.SetPushName(ctx, tx, sender, info.PushName, ms(in.now())); err != nil {
			return err
		}
	}

	pk, created, err := repo.InsertMessage(ctx, tx, row)
	if err != nil {
		return err
	}
	if !created {
		existing, err := repo.GetMessage(ctx, tx, pk)
		if err != nil {
			return err
		}
		if !existing.IsPlaceholder || existing.Raw != nil {
			return nil // a redelivery or a history copy of something we have
		}
		if !in.policy().KeepDeleted {
			return nil // the revoke came first and we don't keep deleted content
		}
		if _, err := repo.FillPlaceholder(ctx, tx, pk, row); err != nil {
			return err
		}
	}
	if c.media != nil {
		c.media.MessagePK = pk
		if err := repo.UpsertMedia(ctx, tx, *c.media); err != nil {
			return err
		}
		if live && in.policy().AutoDownload && autoDownloadable(c.kind, c.media.Size) {
			fx.downloads = append(fx.downloads, pk)
		}
	}
	if err := repo.BumpLastTS(ctx, tx, chat, ts); err != nil {
		return err
	}
	if live && created && !info.IsFromMe {
		if err := repo.IncUnread(ctx, tx, chat); err != nil {
			return err
		}
		fx.notify = append(fx.notify, pk)
	}
	fx.msgs = append(fx.msgs, pk)
	fx.chats[chat] = true
	return nil
}

// AutoDownloadLimit keeps auto-download to things that are cheap and likely to get deleted:
// photos and voice notes up to this size. Everything else downloads when opened.
const AutoDownloadLimit = 16 << 20

func autoDownloadable(kind string, size int64) bool {
	switch kind {
	case repo.KindImage, repo.KindVoice, repo.KindSticker, repo.KindRound, repo.KindGif:
		return size <= AutoDownloadLimit
	}
	return false
}

func webStatus(s waWeb.WebMessageInfo_Status) string {
	switch s {
	case waWeb.WebMessageInfo_ERROR:
		return string(domain.StatusFailed)
	case waWeb.WebMessageInfo_PENDING:
		return string(domain.StatusPending)
	case waWeb.WebMessageInfo_DELIVERY_ACK:
		return string(domain.StatusDelivered)
	case waWeb.WebMessageInfo_READ, waWeb.WebMessageInfo_PLAYED:
		return string(domain.StatusRead)
	}
	return string(domain.StatusSent)
}

func (in *Ingester) ensureChat(ctx context.Context, tx *sql.Tx, fx *effects, chat string, isGroup bool) error {
	if isGroup {
		c, err := repo.GetChat(ctx, tx, chat)
		if errors.Is(err, repo.ErrNotFound) || (err == nil && c.Name == "") {
			if j, err := types.ParseJID(chat); err == nil {
				fx.groups = append(fx.groups, j)
			}
		}
	}
	return repo.EnsureChat(ctx, tx, chat, isGroup)
}

// revoke is anti-delete: the message is marked deleted and keeps its content (unless "keep
// deleted messages" is off). WA sometimes sends the revoke before the original, so then we keep
// a placeholder that the original fills in later.
func (in *Ingester) revoke(ctx context.Context, tx *sql.Tx, fx *effects, chat string, isGroup bool, key *waCommon.MessageKey, revoker string, edit types.EditAttribute, ts int64, me string) error {
	targetID := key.GetID()
	if targetID == "" {
		return nil
	}
	origSender := ""
	switch {
	case key.GetFromMe():
		origSender = me
	case key.GetParticipant() != "":
		if j, err := types.ParseJID(key.GetParticipant()); err == nil {
			origSender = in.jids.Key(ctx, j)
		}
	case !isGroup:
		origSender = chat
	}
	kind := "sender"
	if edit == types.EditAttributeAdminRevoke || (origSender != "" && origSender != revoker) {
		kind = "admin"
	}

	m, err := repo.GetMessageByID(ctx, tx, chat, targetID)
	if errors.Is(err, repo.ErrNotFound) {
		if err := in.ensureChat(ctx, tx, fx, chat, isGroup); err != nil {
			return err
		}
		if origSender == "" {
			origSender = revoker
		}
		m = repo.MessageRow{ChatJID: chat, MsgID: targetID, SenderJID: origSender, FromMe: key.GetFromMe(), TS: ts,
			Kind: repo.KindUnknown, IsPlaceholder: true, ReadSent: true,
			IsDeleted: true, DeletedAt: ts, DeletedBy: revoker, DeleteKind: kind}
		if _, _, err := repo.InsertMessage(ctx, tx, &m); err != nil {
			return err
		}
		if err := repo.BumpLastTS(ctx, tx, chat, ts); err != nil {
			return err
		}
		fx.msgs = append(fx.msgs, m.PK)
		fx.chats[chat] = true
		return nil
	} else if err != nil {
		return err
	}
	if m.IsDeleted {
		return nil
	}
	if err := repo.MarkDeleted(ctx, tx, m.PK, ts, revoker, kind); err != nil {
		return err
	}
	purged := !in.policy().KeepDeleted
	if purged {
		rel, err := repo.PurgeContent(ctx, tx, m.PK)
		if err != nil {
			return err
		}
		if rel != "" {
			fx.files = append(fx.files, rel)
		}
	}
	ct, _ := repo.GetContact(ctx, tx, revoker)
	v := repo.View{Me: me}
	fx.event(evnames.MsgDeleted, domain.MsgDeletedEvent{
		ChatJID: chat, PK: strconv.FormatInt(m.PK, 10), Purged: purged,
		Deleted: domain.DeletedInfo{ByJID: revoker, ByName: v.Name(ct, revoker), At: ts},
	})
	fx.chats[chat] = true
	return nil
}

// edit applies a new version. Version 0 (the original) is saved on the first edit, so the history
// popover can show every step. Edits from anyone but the original sender are ignored.
func (in *Ingester) edit(ctx context.Context, tx *sql.Tx, fx *effects, chat, targetID, editor string, editorFromMe bool, newContent *waE2E.Message, at int64) error {
	if newContent == nil {
		return nil
	}
	m, err := repo.GetMessageByID(ctx, tx, chat, targetID)
	if errors.Is(err, repo.ErrNotFound) {
		in.log.Info("edit for a message we don't have", "id", targetID)
		return nil
	} else if err != nil {
		return err
	}
	if m.FromMe != editorFromMe || (!m.FromMe && m.SenderJID != editor) {
		in.log.Warn("ignoring edit from someone other than the sender", "id", targetID, "sender", redact.JID(m.SenderJID), "editor", redact.JID(editor))
		return nil
	}
	if m.IsDeleted && m.Raw == nil {
		return nil
	}
	body := textOf(newContent)
	if body == m.Body && at <= m.EditedAt {
		return nil // redelivery of an edit we already have
	}
	if in.policy().KeepEditHistory {
		maxV, has, err := repo.MaxEditVersion(ctx, tx, m.PK)
		if err != nil {
			return err
		}
		if !has {
			if err := repo.InsertEdit(ctx, tx, m.PK, repo.EditRow{Version: 0, Body: m.Body, EditedAt: m.TS}); err != nil {
				return err
			}
		}
		if err := repo.InsertEdit(ctx, tx, m.PK, repo.EditRow{Version: maxV + 1, Body: body, EditedAt: at}); err != nil {
			return err
		}
	}
	count := m.EditCount + 1
	cur, curAt := body, at
	if at < m.EditedAt {
		// an older edit showing up late: count it, but keep the newest text
		cur, curAt = m.Body, m.EditedAt
	}
	if err := repo.UpdateBody(ctx, tx, m.PK, cur, count, curAt); err != nil {
		return err
	}
	fx.event(evnames.MsgEdited, domain.MsgEditedEvent{ChatJID: chat, PK: strconv.FormatInt(m.PK, 10), Text: cur, EditedAt: curAt, EditCount: count})
	fx.chats[chat] = true
	return nil
}

// reaction stores (or with an empty emoji, removes) one person's reaction.
func (in *Ingester) reaction(ctx context.Context, tx *sql.Tx, fx *effects, chat, targetID, sender, emoji string, ts int64) error {
	if targetID == "" {
		return nil
	}
	if err := repo.SetReaction(ctx, tx, chat, targetID, sender, emoji, ts); err != nil {
		return err
	}
	m, err := repo.GetMessageByID(ctx, tx, chat, targetID)
	if errors.Is(err, repo.ErrNotFound) {
		return nil // kept; shows up once the message does
	} else if err != nil {
		return err
	}
	aggs, err := repo.ReactionsFor(ctx, tx, chat, []string{targetID}, in.Me(ctx))
	if err != nil {
		return err
	}
	list := []domain.Reaction{}
	for _, a := range aggs[targetID] {
		list = append(list, domain.Reaction{Emoji: a.Emoji, Count: a.Count, Mine: a.Mine})
	}
	fx.event(evnames.MsgReaction, domain.MsgReactionEvent{ChatJID: chat, PK: strconv.FormatInt(m.PK, 10), Reactions: list})
	return nil
}

// The ApplyLocal* functions run our own outgoing edits, revokes and reactions through the same
// code as incoming ones, since whatsmeow doesn't echo what we send.
func (in *Ingester) ApplyLocalEdit(ctx context.Context, chat, msgID, text string, at int64) error {
	me := in.Me(ctx)
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		return in.edit(ctx, tx, fx, chat, msgID, me, true, &waE2E.Message{Conversation: &text}, at)
	})
}

func (in *Ingester) ApplyLocalRevoke(ctx context.Context, chat string, isGroup bool, msgID string, at int64) error {
	me := in.Me(ctx)
	fromMe := true
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		return in.revoke(ctx, tx, fx, chat, isGroup, &waCommon.MessageKey{ID: &msgID, FromMe: &fromMe}, me, types.EditAttributeSenderRevoke, at, me)
	})
}

func (in *Ingester) ApplyLocalReaction(ctx context.Context, chat, msgID, emoji string, at int64) error {
	me := in.Me(ctx)
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		return in.reaction(ctx, tx, fx, chat, msgID, me, emoji, at)
	})
}

// receipts: someone else's delivered/read/played for our messages, or our other device reading
// incoming ones (read-self).
var statusRank = map[string]int{"": 0, "failed": 0, "pending": 1, "sent": 2, "delivered": 3, "read": 4}

func (in *Ingester) receipt(ctx context.Context, tx *sql.Tx, fx *effects, e *events.Receipt) error {
	if skipChat(e.Chat) || len(e.MessageIDs) == 0 {
		return nil
	}
	in.learnSource(ctx, tx, fx, e.MessageSource)
	chat := in.jids.Key(ctx, e.Chat)
	ts := ms(e.Timestamp)

	switch e.Type {
	case types.ReceiptTypeReadSelf, types.ReceiptTypePlayedSelf:
		if err := repo.MarkReadSent(ctx, tx, chat, e.MessageIDs); err != nil {
			return err
		}
		maxTS, err := repo.MaxTSOf(ctx, tx, chat, e.MessageIDs)
		if err != nil || maxTS == 0 {
			return err
		}
		n, err := repo.CountIncomingAfter(ctx, tx, chat, maxTS)
		if err != nil {
			return err
		}
		fx.chats[chat] = true
		return repo.SetUnread(ctx, tx, chat, n)
	}

	var typ string
	switch e.Type {
	case types.ReceiptTypeDelivered:
		typ = "delivered"
	case types.ReceiptTypeRead:
		typ = "read"
	case types.ReceiptTypePlayed:
		typ = "played"
	default:
		return nil
	}
	if e.IsFromMe {
		return nil
	}
	participant := in.jids.Key(ctx, e.Sender)
	c, err := repo.GetChat(ctx, tx, chat)
	if err != nil && !errors.Is(err, repo.ErrNotFound) {
		return err
	}
	last, _ := repo.LastMessage(ctx, tx, chat)
	for _, id := range e.MessageIDs {
		if err := repo.AddReceipt(ctx, tx, chat, id, participant, typ, ts); err != nil {
			return err
		}
		m, err := repo.GetMessageByID(ctx, tx, chat, id)
		if errors.Is(err, repo.ErrNotFound) {
			continue
		} else if err != nil {
			return err
		}
		if !m.FromMe {
			continue
		}
		next := "delivered"
		if typ != "delivered" {
			next = "read"
			if c.IsGroup {
				// in groups it's read once everyone else read it
				n, err := repo.ReceiptCount(ctx, tx, chat, id, []string{"read", "played"})
				if err != nil {
					return err
				}
				if c.MemberCount <= 1 || n < c.MemberCount-1 {
					next = "delivered"
				}
			}
		}
		if statusRank[next] <= statusRank[m.Status] {
			continue
		}
		if err := repo.SetStatus(ctx, tx, m.PK, next); err != nil {
			return err
		}
		fx.event(evnames.MsgStatus, domain.MsgStatusEvent{ChatJID: chat, PK: strconv.FormatInt(m.PK, 10), Status: domain.MessageStatus(next)})
		if last.PK == m.PK {
			fx.chats[chat] = true
		}
	}
	return nil
}

func (in *Ingester) presence(ctx context.Context, e *events.Presence) {
	var last *int64
	if !e.LastSeen.IsZero() {
		v := e.LastSeen.UnixMilli()
		last = &v
	}
	in.emit.Emit(evnames.Presence, domain.PresenceEvent{JID: in.jids.Key(ctx, e.From), Online: !e.Unavailable, LastSeen: last})
}

func (in *Ingester) chatPresence(ctx context.Context, e *events.ChatPresence) {
	if skipChat(e.Chat) {
		return
	}
	sender := in.jids.Key(ctx, e.Sender)
	ct, _ := repo.GetContact(ctx, in.db, sender)
	in.emit.Emit(evnames.ChatTyping, domain.TypingEvent{
		ChatJID:    in.jids.Key(ctx, e.Chat),
		SenderJID:  sender,
		SenderName: in.view(ctx).Name(ct, sender),
		Typing:     e.State == types.ChatPresenceComposing,
	})
}

func (in *Ingester) contact(ctx context.Context, tx *sql.Tx, fx *effects, e *events.Contact) error {
	a := e.Action
	if lid := a.GetLidJID(); lid != "" {
		if l, err := types.ParseJID(lid); err == nil {
			in.learn(ctx, tx, fx, e.JID, l)
		}
	}
	if pn := a.GetPnJID(); pn != "" {
		if p, err := types.ParseJID(pn); err == nil {
			in.learn(ctx, tx, fx, e.JID, p)
		}
	}
	jid := in.jids.Key(ctx, e.JID)
	fx.chats[jid] = true
	return repo.SetContactName(ctx, tx, jid, a.GetFullName(), a.GetFirstName(), ms(in.now()))
}

// UpsertGroup stores a group's name, description and members.
func (in *Ingester) UpsertGroup(ctx context.Context, tx *sql.Tx, fx *effects, g *types.GroupInfo) error {
	jid := g.JID.String()
	creator := ""
	if !g.OwnerJID.IsEmpty() {
		if !g.OwnerPN.IsEmpty() {
			in.learn(ctx, tx, fx, g.OwnerJID, g.OwnerPN)
		}
		creator = in.jids.Key(ctx, g.OwnerJID)
	}
	if err := repo.UpsertGroup(ctx, tx, repo.GroupMeta{JID: jid, Name: g.Name, Description: g.Topic,
		CreatedAt: ms(g.GroupCreated), CreatedBy: creator, MemberCount: len(g.Participants)}); err != nil {
		return err
	}
	if !g.GroupCreated.IsZero() {
		if err := repo.AddGroupEvent(ctx, tx, jid, repo.GroupEvent{TS: ms(g.GroupCreated), Kind: repo.GroupCreate, Actor: creator}); err != nil {
			return err
		}
	}
	ps := make([]repo.Participant, 0, len(g.Participants))
	for _, p := range g.Participants {
		if !p.LID.IsEmpty() && !p.PhoneNumber.IsEmpty() {
			in.learn(ctx, tx, fx, p.LID, p.PhoneNumber)
		}
		ps = append(ps, repo.Participant{JID: in.jids.Key(ctx, p.JID), IsAdmin: p.IsAdmin, IsSuperAdmin: p.IsSuperAdmin})
	}
	if len(ps) > 0 {
		if err := repo.ReplaceParticipants(ctx, tx, jid, ps); err != nil {
			return err
		}
	}
	fx.chats[jid] = true
	return nil
}

func (in *Ingester) groupChange(ctx context.Context, tx *sql.Tx, fx *effects, e *events.GroupInfo) error {
	jid := e.JID.String()
	if err := repo.EnsureChat(ctx, tx, jid, true); err != nil {
		return err
	}
	if err := in.liveGroupEvents(ctx, tx, e); err != nil {
		return err
	}
	if e.Name != nil {
		if err := repo.SetChatName(ctx, tx, jid, e.Name.Name); err != nil {
			return err
		}
	}
	if e.Topic != nil {
		if err := repo.SetGroupDescription(ctx, tx, jid, e.Topic.Topic); err != nil {
			return err
		}
	}
	keys := func(list []types.JID) []string {
		out := make([]string, len(list))
		for i, j := range list {
			out[i] = in.jids.Key(ctx, j)
		}
		return out
	}
	if len(e.Join) > 0 {
		var ps []repo.Participant
		for _, k := range keys(e.Join) {
			ps = append(ps, repo.Participant{JID: k})
		}
		if err := repo.AddParticipants(ctx, tx, jid, ps); err != nil {
			return err
		}
	}
	if err := repo.RemoveParticipants(ctx, tx, jid, keys(e.Leave)); err != nil {
		return err
	}
	if err := repo.SetAdmin(ctx, tx, jid, keys(e.Promote), true); err != nil {
		return err
	}
	if err := repo.SetAdmin(ctx, tx, jid, keys(e.Demote), false); err != nil {
		return err
	}
	if len(e.Join)+len(e.Leave) > 0 {
		if err := repo.SyncMemberCount(ctx, tx, jid); err != nil {
			return err
		}
	}
	fx.chats[jid] = true
	return nil
}

func (in *Ingester) fetchGroup(jid types.JID) {
	in.groupsMu.Lock()
	if in.groupsFetched[jid.String()] {
		in.groupsMu.Unlock()
		return
	}
	in.groupsFetched[jid.String()] = true
	in.groupsMu.Unlock()
	cli := in.cli()
	if cli == nil || !cli.IsConnected() {
		in.groupsMu.Lock()
		delete(in.groupsFetched, jid.String())
		in.groupsMu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	g, err := cli.GetGroupInfo(ctx, jid)
	if err != nil {
		in.log.Warn("group info", "group", redact.JID(jid.String()), "error", redact.Digits(err.Error()))
		return
	}
	if err := in.run(ctx, func(tx *sql.Tx, fx *effects) error { return in.UpsertGroup(ctx, tx, fx, g) }); err != nil {
		in.log.Error("store group info", "error", err)
	}
}

// SyncGroups stores every group we're in; called after connecting.
func (in *Ingester) SyncGroups(ctx context.Context, groups []*types.GroupInfo) error {
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		for _, g := range groups {
			if err := in.UpsertGroup(ctx, tx, fx, g); err != nil {
				return err
			}
			in.groupsMu.Lock()
			in.groupsFetched[g.JID.String()] = true
			in.groupsMu.Unlock()
		}
		return nil
	})
}

// SyncContacts copies the names whatsmeow got from the phone's address book.
func (in *Ingester) SyncContacts(ctx context.Context, contacts map[types.JID]types.ContactInfo) error {
	now := ms(in.now())
	return in.run(ctx, func(tx *sql.Tx, fx *effects) error {
		for j, c := range contacts {
			key := in.jids.Key(ctx, j)
			if c.FullName != "" || c.FirstName != "" {
				if err := repo.SetContactName(ctx, tx, key, c.FullName, c.FirstName, now); err != nil {
					return err
				}
			}
			if c.PushName != "" {
				if err := repo.SetPushName(ctx, tx, key, c.PushName, now); err != nil {
					return err
				}
			}
			if c.BusinessName != "" {
				if err := repo.SetBusinessName(ctx, tx, key, c.BusinessName, now); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (in *Ingester) notifyOne(ctx context.Context, v repo.View, m domain.Message) {
	c, err := repo.GetChat(ctx, in.db, m.ChatJID)
	if err != nil {
		return
	}
	chat, err := v.Chat(ctx, in.db, c)
	if err != nil {
		return
	}
	in.notify.Incoming(m, chat)
}
