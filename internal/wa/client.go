// Package wa wraps whatsmeow: the client lifecycle and login, JID normalization and sending.
// Everything above this package talks to the small Client interface, so tests use a fake.
package wa

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Client is the part of whatsmeow we use. Outgoing presence, typing and read receipts are
// deliberately not here: they live on PresenceTransport and only internal/privacy gets one.
type Client interface {
	Connect() error
	Disconnect()
	IsConnected() bool
	IsLoggedIn() bool
	Logout(ctx context.Context) error
	// DeleteSession drops the device from session.db without telling the server (for when we
	// can't connect to log out properly).
	DeleteSession(ctx context.Context) error
	GetQRChannel(ctx context.Context) (<-chan whatsmeow.QRChannelItem, error)
	PairPhone(ctx context.Context, phone string) (string, error)
	AddEventHandler(fn func(evt any) bool) uint32
	RemoveEventHandler(id uint32) bool

	OwnID() types.JID
	OwnLID() types.JID
	PushName() string
	LIDs() waStore.LIDStore

	GenerateMessageID() types.MessageID
	SendMessage(ctx context.Context, to types.JID, msg *waE2E.Message, id types.MessageID) (whatsmeow.SendResponse, error)
	BuildEdit(chat types.JID, id types.MessageID, content *waE2E.Message) *waE2E.Message
	BuildRevoke(chat, sender types.JID, id types.MessageID) *waE2E.Message
	BuildReaction(chat, sender types.JID, id types.MessageID, emoji string) *waE2E.Message
	ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error)

	DownloadMedia(ctx context.Context, m MediaRef) ([]byte, error)
	Upload(ctx context.Context, data []byte, mt whatsmeow.MediaType) (whatsmeow.UploadResponse, error)

	GetJoinedGroups(ctx context.Context) ([]*types.GroupInfo, error)
	GetGroupInfo(ctx context.Context, jid types.JID) (*types.GroupInfo, error)
	SubscribePresence(ctx context.Context, jid types.JID) error
	SendAppState(ctx context.Context, patch appstate.PatchInfo) error
	SetPushName(ctx context.Context, name string) error
	SetAbout(ctx context.Context, about string) error
	GetAbout(ctx context.Context, jid types.JID) (string, error)
	// GetProfilePicture returns nil, nil when the picture is still existingID
	GetProfilePicture(ctx context.Context, jid types.JID, existingID string, preview bool) (*types.ProfilePictureInfo, error)
	AllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error)
	// IsOnWhatsApp asks which phone numbers ("+" and digits) have an account
	IsOnWhatsApp(ctx context.Context, phones []string) ([]types.IsOnWhatsAppResponse, error)
	// polls: votes come encrypted with the poll's message secret, which whatsmeow keeps
	DecryptPollVote(ctx context.Context, vote *events.Message) (*waE2E.PollVoteMessage, error)
	BuildPollVote(ctx context.Context, poll *types.MessageInfo, options []string) (*waE2E.Message, error)
	BuildPollCreation(name string, options []string, selectable int) *waE2E.Message

	// Blocked lists who we blocked; SetBlocked blocks or unblocks one person.
	Blocked(ctx context.Context) ([]types.JID, error)
	SetBlocked(ctx context.Context, jid types.JID, block bool) error
	LeaveGroup(ctx context.Context, group types.JID) error
	GetSubGroups(ctx context.Context, community types.JID) ([]*types.GroupLinkTarget, error)

	// channels
	GetSubscribedNewsletters(ctx context.Context) ([]*types.NewsletterMetadata, error)
	// before 0 = the newest
	GetNewsletterPosts(ctx context.Context, jid types.JID, count int, before types.MessageServerID) ([]*types.NewsletterMessage, error)
	NewsletterSubscribeLiveUpdates(ctx context.Context, jid types.JID) (time.Duration, error)
	NewsletterSendReaction(ctx context.Context, jid types.JID, serverID types.MessageServerID, reaction string, messageID types.MessageID) error
	GetNewsletterInfoWithInvite(ctx context.Context, key string) (*types.NewsletterMetadata, error)
	GetNewsletterInfo(ctx context.Context, jid types.JID) (*types.NewsletterMetadata, error)
	FollowNewsletter(ctx context.Context, jid types.JID) error
	UnfollowNewsletter(ctx context.Context, jid types.JID) error
	SetDisappearingTimer(ctx context.Context, chat types.JID, timer time.Duration, settingTS time.Time) error
	RemoveParticipants(ctx context.Context, group types.JID, members []types.JID) error
}

// PresenceTransport is what the privacy gate sends through. Nothing else may hold one; a test in
// internal/privacy checks that no other package calls these methods.
type PresenceTransport interface {
	SendPresence(ctx context.Context, state types.Presence) error
	SendChatPresence(ctx context.Context, jid types.JID, state types.ChatPresence, media types.ChatPresenceMedia) error
	MarkRead(ctx context.Context, ids []types.MessageID, ts time.Time, chat, sender types.JID) error
	// MarkPlayed is the "played" receipt for voice notes (and view-once media)
	MarkPlayed(ctx context.Context, ids []types.MessageID, ts time.Time, chat, sender types.JID) error
}

// MediaRef is what we keep in the media table to download an attachment later.
type MediaRef struct {
	DirectPath    string
	MediaKey      []byte
	FileSHA256    []byte
	FileEncSHA256 []byte
	MediaType     whatsmeow.MediaType
}

// Meow adapts *whatsmeow.Client to Client and PresenceTransport.
type Meow struct {
	Cli *whatsmeow.Client
}

var (
	_ Client            = (*Meow)(nil)
	_ PresenceTransport = (*Meow)(nil)
)

func (m *Meow) Connect() error                   { return m.Cli.Connect() }
func (m *Meow) Disconnect()                      { m.Cli.Disconnect() }
func (m *Meow) IsConnected() bool                { return m.Cli.IsConnected() }
func (m *Meow) IsLoggedIn() bool                 { return m.Cli.IsLoggedIn() }
func (m *Meow) Logout(ctx context.Context) error { return m.Cli.Logout(ctx) }
func (m *Meow) DeleteSession(ctx context.Context) error {
	if m.Cli.Store.ID == nil {
		return nil
	}
	return m.Cli.Store.Delete(ctx)
}

func (m *Meow) GetQRChannel(ctx context.Context) (<-chan whatsmeow.QRChannelItem, error) {
	return m.Cli.GetQRChannel(ctx)
}

func (m *Meow) PairPhone(ctx context.Context, phone string) (string, error) {
	// the display name has to look like "Browser (OS)", the server rejects anything else
	return m.Cli.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Windows)")
}

func (m *Meow) AddEventHandler(fn func(evt any) bool) uint32 {
	return m.Cli.AddEventHandlerWithSuccessStatus(fn)
}
func (m *Meow) RemoveEventHandler(id uint32) bool { return m.Cli.RemoveEventHandler(id) }

func (m *Meow) OwnID() types.JID {
	if m.Cli.Store.ID == nil {
		return types.EmptyJID
	}
	return m.Cli.Store.ID.ToNonAD()
}
func (m *Meow) OwnLID() types.JID                  { return m.Cli.Store.GetLID().ToNonAD() }
func (m *Meow) PushName() string                   { return m.Cli.Store.PushName }
func (m *Meow) LIDs() waStore.LIDStore             { return m.Cli.Store.LIDs }
func (m *Meow) GenerateMessageID() types.MessageID { return m.Cli.GenerateMessageID() }

func (m *Meow) SendMessage(ctx context.Context, to types.JID, msg *waE2E.Message, id types.MessageID) (whatsmeow.SendResponse, error) {
	return m.Cli.SendMessage(ctx, to, msg, whatsmeow.SendRequestExtra{ID: id})
}

func (m *Meow) BuildEdit(chat types.JID, id types.MessageID, content *waE2E.Message) *waE2E.Message {
	return m.Cli.BuildEdit(chat, id, content)
}
func (m *Meow) BuildRevoke(chat, sender types.JID, id types.MessageID) *waE2E.Message {
	return m.Cli.BuildRevoke(chat, sender, id)
}
func (m *Meow) BuildReaction(chat, sender types.JID, id types.MessageID, emoji string) *waE2E.Message {
	return m.Cli.BuildReaction(chat, sender, id, emoji)
}
func (m *Meow) ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error) {
	return m.Cli.ParseWebMessage(chat, msg)
}

func (m *Meow) DownloadMedia(ctx context.Context, r MediaRef) ([]byte, error) {
	if r.DirectPath == "" || len(r.MediaKey) == 0 {
		return nil, fmt.Errorf("media has no download path")
	}
	return m.Cli.DownloadMediaWithPath(ctx, r.DirectPath, r.FileEncSHA256, r.FileSHA256, r.MediaKey, r.MediaType, "", false)
}

func (m *Meow) Upload(ctx context.Context, data []byte, mt whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
	return m.Cli.Upload(ctx, data, mt)
}

func (m *Meow) GetJoinedGroups(ctx context.Context) ([]*types.GroupInfo, error) {
	return m.Cli.GetJoinedGroups(ctx)
}
func (m *Meow) GetGroupInfo(ctx context.Context, jid types.JID) (*types.GroupInfo, error) {
	return m.Cli.GetGroupInfo(ctx, jid)
}
func (m *Meow) SubscribePresence(ctx context.Context, jid types.JID) error {
	return m.Cli.SubscribePresence(ctx, jid)
}
func (m *Meow) SendAppState(ctx context.Context, patch appstate.PatchInfo) error {
	return m.Cli.SendAppState(ctx, patch)
}
func (m *Meow) SetPushName(ctx context.Context, name string) error {
	return m.Cli.SendAppState(ctx, appstate.BuildSettingPushName(name))
}

// SetAbout changes the "About" line. WhatsApp has been moving it to a newer "text status", and
// whatsmeow's mutation for that has been refused (400) with an expiry of 0, so this tries, in
// order: the mutation with just the text, the old "status" IQ WhatsApp Web used for years, and
// whatsmeow's own call. The first one the server accepts wins.
func (m *Meow) SetAbout(ctx context.Context, about string) error {
	var errs []error
	if _, err := m.Cli.DangerousInternals().SendMexIQ(ctx, mutationUpdateTextStatus, map[string]any{
		"input": map[string]any{"text": about},
	}); err == nil {
		return nil
	} else {
		errs = append(errs, fmt.Errorf("text status: %w", err))
	}
	if err := m.setAboutIQ(ctx, about); err == nil {
		return nil
	} else {
		errs = append(errs, fmt.Errorf("status: %w", err))
	}
	if err := m.Cli.SetStatusMessage(ctx, types.SetStatusInput{Text: &about}); err == nil {
		return nil
	} else {
		errs = append(errs, fmt.Errorf("whatsmeow: %w", err))
	}
	return errors.Join(errs...)
}

// the mutation id whatsmeow uses for UpdateTextStatus
const mutationUpdateTextStatus = "9152604461510864"

// setAboutIQ is the classic <iq xmlns="status" type="set"><status>text</status></iq>.
func (m *Meow) setAboutIQ(ctx context.Context, about string) error {
	in := m.Cli.DangerousInternals()
	id := in.GenerateRequestID()
	wait := in.WaitResponse(id)
	err := in.SendNode(ctx, waBinary.Node{
		Tag: "iq",
		Attrs: waBinary.Attrs{
			"id":    id,
			"to":    types.ServerJID,
			"type":  "set",
			"xmlns": "status",
		},
		Content: []waBinary.Node{{Tag: "status", Content: []byte(about)}},
	})
	if err != nil {
		return err
	}
	select {
	case res := <-wait:
		if res == nil {
			return errors.New("no answer")
		}
		if t, _ := res.Attrs["type"].(string); t != "result" {
			if e, ok := res.GetOptionalChildByTag("error"); ok {
				return fmt.Errorf("server said %v %v", e.Attrs["code"], e.Attrs["text"])
			}
			return fmt.Errorf("server answered %q", t)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(20 * time.Second):
		return errors.New("no answer in 20 s")
	}
}
func (m *Meow) GetAbout(ctx context.Context, jid types.JID) (string, error) {
	info, err := m.Cli.GetUserInfo(ctx, []types.JID{jid.ToNonAD()})
	if err != nil {
		return "", err
	}
	return pickAbout(info, jid), nil
}

// pickAbout finds the answer for jid. WhatsApp may key it by the person's LID while we asked by
// phone number (or the other way round), so an exact miss falls back to the entry that names jid
// as its LID, and then to the only entry there is.
func pickAbout(info map[types.JID]types.UserInfo, jid types.JID) string {
	jid = jid.ToNonAD()
	if u, ok := info[jid]; ok {
		return u.Status
	}
	for k, u := range info {
		if k.User == jid.User || u.LID.User == jid.User {
			return u.Status
		}
	}
	if len(info) == 1 {
		for _, u := range info {
			return u.Status
		}
	}
	return ""
}
func (m *Meow) GetProfilePicture(ctx context.Context, jid types.JID, existingID string, preview bool) (*types.ProfilePictureInfo, error) {
	if jid.Server == types.NewsletterServer {
		return m.channelPicture(ctx, jid, existingID, preview)
	}
	return m.Cli.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{Preview: preview, ExistingID: existingID})
}

// channelPicture reads a channel's picture from its info (whatsmeow's profile picture call
// doesn't do channels).
func (m *Meow) channelPicture(ctx context.Context, jid types.JID, existingID string, preview bool) (*types.ProfilePictureInfo, error) {
	info, err := m.Cli.GetNewsletterInfo(ctx, jid)
	if err != nil {
		return nil, err
	}
	pic := info.ThreadMeta.Picture
	if preview || pic == nil || (pic.URL == "" && pic.DirectPath == "") {
		p := info.ThreadMeta.Preview
		pic = &p
	}
	if pic.URL == "" && pic.DirectPath != "" {
		pic.URL = "https://mmg.whatsapp.net" + pic.DirectPath
	}
	if pic.URL == "" {
		return nil, whatsmeow.ErrProfilePictureNotSet
	}
	if pic.ID != "" && pic.ID == existingID {
		return nil, nil
	}
	return pic, nil
}
func (m *Meow) AllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
	return m.Cli.Store.Contacts.GetAllContacts(ctx)
}

func (m *Meow) DecryptPollVote(ctx context.Context, vote *events.Message) (*waE2E.PollVoteMessage, error) {
	return m.Cli.DecryptPollVote(ctx, vote)
}
func (m *Meow) BuildPollVote(ctx context.Context, poll *types.MessageInfo, options []string) (*waE2E.Message, error) {
	return m.Cli.BuildPollVote(ctx, poll, options)
}

func (m *Meow) BuildPollCreation(name string, options []string, selectable int) *waE2E.Message {
	return m.Cli.BuildPollCreation(name, options, selectable)
}

func (m *Meow) IsOnWhatsApp(ctx context.Context, phones []string) ([]types.IsOnWhatsAppResponse, error) {
	return m.Cli.IsOnWhatsApp(ctx, phones)
}

// The four below are only reachable through PresenceTransport.

func (m *Meow) SendPresence(ctx context.Context, state types.Presence) error {
	return m.Cli.SendPresence(ctx, state)
}
func (m *Meow) SendChatPresence(ctx context.Context, jid types.JID, state types.ChatPresence, media types.ChatPresenceMedia) error {
	return m.Cli.SendChatPresence(ctx, jid, state, media)
}
func (m *Meow) MarkRead(ctx context.Context, ids []types.MessageID, ts time.Time, chat, sender types.JID) error {
	return m.Cli.MarkRead(ctx, ids, ts, chat, sender)
}
func (m *Meow) MarkPlayed(ctx context.Context, ids []types.MessageID, ts time.Time, chat, sender types.JID) error {
	return m.Cli.MarkRead(ctx, ids, ts, chat, sender, types.ReceiptTypePlayed)
}

func (m *Meow) Blocked(ctx context.Context) ([]types.JID, error) {
	bl, err := m.Cli.GetBlocklist(ctx, "")
	if err != nil {
		return nil, err
	}
	var out []types.JID
	for _, it := range bl.Items {
		if !it.PN.IsEmpty() {
			out = append(out, it.PN)
		}
		if !it.LID.IsEmpty() {
			out = append(out, it.LID)
		}
	}
	return out, nil
}

func (m *Meow) SetBlocked(ctx context.Context, jid types.JID, block bool) error {
	// the server wants the current list hash with every change
	bl, err := m.Cli.GetBlocklist(ctx, "")
	if err != nil {
		return err
	}
	action := events.BlocklistChangeActionUnblock
	if block {
		action = events.BlocklistChangeActionBlock
	}
	_, err = m.Cli.UpdateBlocklist(ctx, jid, action, bl.DHash)
	return err
}

func (m *Meow) SetDisappearingTimer(ctx context.Context, chat types.JID, timer time.Duration, settingTS time.Time) error {
	return m.Cli.SetDisappearingTimer(ctx, chat, timer, settingTS)
}

func (m *Meow) GetSubscribedNewsletters(ctx context.Context) ([]*types.NewsletterMetadata, error) {
	return m.Cli.GetSubscribedNewsletters(ctx)
}

func (m *Meow) GetNewsletterPosts(ctx context.Context, jid types.JID, count int, before types.MessageServerID) ([]*types.NewsletterMessage, error) {
	return m.Cli.GetNewsletterMessages(ctx, jid, &whatsmeow.GetNewsletterMessagesParams{Count: count, Before: before})
}

func (m *Meow) NewsletterSubscribeLiveUpdates(ctx context.Context, jid types.JID) (time.Duration, error) {
	return m.Cli.NewsletterSubscribeLiveUpdates(ctx, jid)
}

func (m *Meow) NewsletterSendReaction(ctx context.Context, jid types.JID, serverID types.MessageServerID, reaction string, messageID types.MessageID) error {
	return m.Cli.NewsletterSendReaction(ctx, jid, serverID, reaction, messageID)
}

func (m *Meow) GetNewsletterInfoWithInvite(ctx context.Context, key string) (*types.NewsletterMetadata, error) {
	return m.Cli.GetNewsletterInfoWithInvite(ctx, key)
}

func (m *Meow) GetNewsletterInfo(ctx context.Context, jid types.JID) (*types.NewsletterMetadata, error) {
	return m.Cli.GetNewsletterInfo(ctx, jid)
}

func (m *Meow) FollowNewsletter(ctx context.Context, jid types.JID) error {
	return m.Cli.FollowNewsletter(ctx, jid)
}

func (m *Meow) UnfollowNewsletter(ctx context.Context, jid types.JID) error {
	return m.Cli.UnfollowNewsletter(ctx, jid)
}

func (m *Meow) GetSubGroups(ctx context.Context, community types.JID) ([]*types.GroupLinkTarget, error) {
	return m.Cli.GetSubGroups(ctx, community)
}

func (m *Meow) LeaveGroup(ctx context.Context, group types.JID) error {
	return m.Cli.LeaveGroup(ctx, group)
}

func (m *Meow) RemoveParticipants(ctx context.Context, group types.JID, members []types.JID) error {
	res, err := m.Cli.UpdateGroupParticipants(ctx, group, members, whatsmeow.ParticipantChangeRemove)
	if err != nil {
		return err
	}
	for _, p := range res {
		if p.Error != 0 {
			return fmt.Errorf("WhatsApp refused the change (error %d)", p.Error)
		}
	}
	return nil
}
