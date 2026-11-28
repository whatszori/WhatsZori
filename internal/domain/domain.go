// Package domain holds the DTOs the frontend sees. They mirror frontend/src/api/types.ts; the
// frontend never gets protobufs or whatsmeow types.
package domain

import "strings"

type AuthState string

const (
	AuthLoggedOut AuthState = "logged-out"
	AuthQR        AuthState = "qr"
	AuthPairing   AuthState = "pairing"
	AuthLoggingIn AuthState = "logging-in"
	AuthLoggedIn  AuthState = "logged-in"
)

type ConnState string

const (
	ConnConnected    ConnState = "connected"
	ConnConnecting   ConnState = "connecting"
	ConnReconnecting ConnState = "reconnecting"
	ConnOffline      ConnState = "offline"
)

type Me struct {
	JID   string `json:"jid"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type AuthStatus struct {
	State AuthState `json:"state"`
	Me    *Me       `json:"me"`
}

type QRPayload struct {
	Code string `json:"code"`
	// ms until WA rotates the code
	ExpiresIn int64 `json:"expiresIn"`
}

type Profile struct {
	Name  string `json:"name"`
	About string `json:"about"`
	Phone string `json:"phone"`
}

// UI kinds. The store keeps finer ones (location, poll, audio, ...); see UIKind.
type MessageKind string

const (
	KindText     MessageKind = "text"
	KindImage    MessageKind = "image"
	KindVideo    MessageKind = "video"
	KindDocument MessageKind = "document"
	KindVoice    MessageKind = "voice"
	KindSticker  MessageKind = "sticker"
	KindPoll     MessageKind = "poll"
	KindLocation MessageKind = "location"
	KindContact  MessageKind = "contact"
	KindEvent    MessageKind = "event"
)

type MessageStatus string

const (
	StatusPending   MessageStatus = "pending"
	StatusSent      MessageStatus = "sent"
	StatusDelivered MessageStatus = "delivered"
	StatusRead      MessageStatus = "read"
	StatusFailed    MessageStatus = "failed"
)

type MessagePreview struct {
	PK         string        `json:"pk"`
	FromMe     bool          `json:"fromMe"`
	SenderName string        `json:"senderName"`
	Kind       MessageKind   `json:"kind"`
	Text       string        `json:"text"`
	Deleted    bool          `json:"deleted"`
	Status     MessageStatus `json:"status,omitempty"`
}

type Chat struct {
	JID          string          `json:"jid"`
	Name         string          `json:"name"`
	IsGroup      bool            `json:"isGroup"`
	MemberCount  int             `json:"memberCount,omitempty"`
	Pinned       bool            `json:"pinned"`
	Archived     bool            `json:"archived"`
	Muted        bool            `json:"muted"`
	Unread       int             `json:"unread"`
	LastMessage  *MessagePreview `json:"lastMessage"`
	LastActivity int64           `json:"lastActivity"`
	// only in WhatsZori, not synced with the phone
	Favorite bool    `json:"favorite,omitempty"`
	Lists    []int64 `json:"lists,omitempty"`
	// presence comes through its own event; these stay empty in snapshots
	LastSeen *int64 `json:"lastSeen,omitempty"`
	Online   bool   `json:"online,omitempty"`
	// disappearing messages timer in seconds, 0 = off (WhatsZori keeps the messages anyway)
	Disappearing int `json:"disappearing,omitempty"`
}

type GroupMember struct {
	JID     string `json:"jid"`
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	IsMe    bool   `json:"isMe"`
	IsAdmin bool   `json:"isAdmin"`
}

type MediaRef struct {
	PK       string      `json:"pk"`
	Kind     MessageKind `json:"kind"`
	Width    int         `json:"width,omitempty"`
	Height   int         `json:"height,omitempty"`
	Duration int         `json:"duration,omitempty"`
}

type ChatInfo struct {
	JID         string        `json:"jid"`
	About       string        `json:"about"`
	Phone       string        `json:"phone,omitempty"`
	Members     []GroupMember `json:"members,omitempty"`
	CreatedAt   int64         `json:"createdAt,omitempty"`
	CreatedBy   string        `json:"createdBy,omitempty"`
	MediaCount  int           `json:"mediaCount"`
	DocCount    int           `json:"docCount"`
	LinkCount   int           `json:"linkCount"`
	RecentMedia []MediaRef    `json:"recentMedia"`
	DeletedKept int           `json:"deletedKept"`
	Edited      int           `json:"edited"`
	// 1:1 only: we blocked them (as far as we know; needs a connection to check)
	Blocked bool `json:"blocked,omitempty"`
	// a contact we have no chat with yet
	NoChat bool `json:"noChat,omitempty"`
	// display name, for contacts opened from a group
	Name string `json:"name"`
}

type ChatList struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

type GroupEvent struct {
	At         int64  `json:"at"`
	Kind       string `json:"kind"`
	ActorJID   string `json:"actorJid"`
	ActorName  string `json:"actorName"`
	TargetJID  string `json:"targetJid"`
	TargetName string `json:"targetName"`
}

type ExportOptions struct {
	JID string `json:"jid"`
	// photo, video, voice, round, sticker, gif, file
	Media []string `json:"media"`
	// per file, 0 = no limit
	MaxBytes int64 `json:"maxBytes"`
	// html, json or txt
	Format string `json:"format"`
	// ms, 0 = open-ended
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

type ExportProgressEvent struct {
	JID   string `json:"jid"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
	// collecting, media, writing, done, failed, cancelled
	Phase string `json:"phase"`
}

type MediaInfo struct {
	Width    int       `json:"width,omitempty"`
	Height   int       `json:"height,omitempty"`
	FileName string    `json:"fileName,omitempty"`
	Size     int64     `json:"size,omitempty"`
	Mime     string    `json:"mime,omitempty"`
	Duration int       `json:"duration,omitempty"`
	Waveform []float64 `json:"waveform,omitempty"`
	Caption  string    `json:"caption,omitempty"`
	// a video note: shown as a circle and played inline
	Round bool `json:"round,omitempty"`
	// plays muted on a loop, like any GIF
	Gif bool `json:"gif,omitempty"`
	// nothing to download: WhatsApp gave the keys to the phone only (view once, mostly)
	Unavailable bool `json:"unavailable,omitempty"`
}

// a person mentioned in a message: the text has "@" + Token where the app shows "@" + Name
type Mention struct {
	// canonical JID (the phone-number JID when we know it)
	JID string `json:"jid"`
	// what follows "@" in the text: the user part of the JID the sender used
	Token string `json:"token"`
	// empty when we don't know who it is
	Name string `json:"name"`
}

// MentionNames writes names in place of "@<token>", for previews and notifications.
func MentionNames(text string, ms []Mention) string {
	for _, m := range ms {
		if m.Token != "" && m.Name != "" {
			text = strings.ReplaceAll(text, "@"+m.Token, "@"+m.Name)
		}
	}
	return text
}

// a pin or a live location
type LocationInfo struct {
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Name    string  `json:"name,omitempty"`
	Address string  `json:"address,omitempty"`
	URL     string  `json:"url,omitempty"`
	Live    bool    `json:"live"`
	// metres, 0 = unknown
	Accuracy int `json:"accuracy,omitempty"`
	// live: metres per second, degrees from north, the update count, when it last moved (ms)
	Speed     float64 `json:"speed,omitempty"`
	Heading   int     `json:"heading,omitempty"`
	Sequence  int64   `json:"sequence,omitempty"`
	UpdatedAt int64   `json:"updatedAt,omitempty"`
	// the map picture the sender's phone made, as a data: URL; empty when there's none
	Thumb string `json:"thumb,omitempty"`
}

// who got a message of ours, and who read it
type MessageReceipts struct {
	People []ReceiptPerson `json:"people"`
}

type ReceiptPerson struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
	// ms; 0 = not yet (all zero: still waiting)
	DeliveredAt int64 `json:"deliveredAt"`
	ReadAt      int64 `json:"readAt"`
	// a voice or video note was played
	PlayedAt int64 `json:"playedAt"`
}

// a shared contact (one vCard)
type ContactCard struct {
	Name   string         `json:"name"`
	Org    string         `json:"org,omitempty"`
	Phones []ContactPhone `json:"phones"`
	Emails []string       `json:"emails"`
}

type ContactPhone struct {
	Number string `json:"number"`
	// home, cell, work, ...
	Label string `json:"label,omitempty"`
	// the WhatsApp number, when the phone said it's on WhatsApp
	WAID string `json:"waid,omitempty"`
	JID  string `json:"jid,omitempty"`
}

// an event (WhatsApp's "Event" in groups and chats)
type EventInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// ms; End 0 = no end time
	Start    int64   `json:"start"`
	End      int64   `json:"end,omitempty"`
	Place    string  `json:"place,omitempty"`
	Lat      float64 `json:"lat,omitempty"`
	Lon      float64 `json:"lon,omitempty"`
	JoinLink string  `json:"joinLink,omitempty"`
	Canceled bool    `json:"canceled"`
	// a scheduled call rather than a meeting
	Call bool `json:"call"`
	// the cover picture (data: URL)
	Cover string `json:"cover,omitempty"`
}

// a business message's parts around the text, and what can be tapped
type BusinessInfo struct {
	Header   string `json:"header,omitempty"`
	Subtitle string `json:"subtitle,omitempty"`
	Footer   string `json:"footer,omitempty"`
	// a header picture that isn't downloadable media (data: URL)
	Thumb   string      `json:"thumb,omitempty"`
	Buttons []BizButton `json:"buttons"`
	// what the "list" button opens
	List *BizList `json:"list,omitempty"`
	// a carousel's cards
	Cards []BizCard `json:"cards,omitempty"`
}

type BizButton struct {
	// reply, url, call, copy, list or other (a flow the app can't run: payments, forms, ...)
	Kind  string `json:"kind"`
	Text  string `json:"text"`
	ID    string `json:"id,omitempty"`
	URL   string `json:"url,omitempty"`
	Phone string `json:"phone,omitempty"`
	Code  string `json:"code,omitempty"`
	// the native flow name, for "other"
	Name string `json:"name,omitempty"`
}

type BizList struct {
	Button   string       `json:"button"`
	Title    string       `json:"title,omitempty"`
	Sections []BizSection `json:"sections"`
}

type BizSection struct {
	Title string   `json:"title,omitempty"`
	Rows  []BizRow `json:"rows"`
}

type BizRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

type BizCard struct {
	Header  string      `json:"header,omitempty"`
	Body    string      `json:"body,omitempty"`
	Footer  string      `json:"footer,omitempty"`
	Thumb   string      `json:"thumb,omitempty"`
	Buttons []BizButton `json:"buttons"`
}

type ReplyRef struct {
	PK         string      `json:"pk"`
	SenderName string      `json:"senderName"`
	FromMe     bool        `json:"fromMe"`
	Kind       MessageKind `json:"kind"`
	Text       string      `json:"text"`
}

type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

type DeletedInfo struct {
	ByJID  string `json:"byJid"`
	ByName string `json:"byName"`
	At     int64  `json:"at"`
}

type Message struct {
	PK             string        `json:"pk"`
	ID             string        `json:"id"`
	ChatJID        string        `json:"chatJid"`
	SenderJID      string        `json:"senderJid"`
	SenderName     string        `json:"senderName"`
	FromMe         bool          `json:"fromMe"`
	Timestamp      int64         `json:"timestamp"`
	Kind           MessageKind   `json:"kind"`
	Text           string        `json:"text"`
	Media          *MediaInfo    `json:"media,omitempty"`
	ReplyTo        *ReplyRef     `json:"replyTo,omitempty"`
	Status         MessageStatus `json:"status,omitempty"`
	EditedAt       int64         `json:"editedAt,omitempty"`
	EditCount      int           `json:"editCount,omitempty"`
	Deleted        *DeletedInfo  `json:"deleted,omitempty"`
	ContentUnknown bool          `json:"contentUnknown,omitempty"`
	// WhatsApp's forwarding score: 0 not forwarded, 5+ "forwarded many times"
	Forwarded int       `json:"forwarded,omitempty"`
	Poll      *PollInfo `json:"poll,omitempty"`
	// a "view once" photo, video or voice note; WhatsZori keeps it anyway
	ViewOnce bool `json:"viewOnce,omitempty"`
	// sent as a disappearing message (kept here anyway)
	Disappearing bool       `json:"disappearing,omitempty"`
	Reactions    []Reaction `json:"reactions"`
	// people mentioned in the text
	Mentions []Mention `json:"mentions,omitempty"`
	// a pin or a live location
	Location *LocationInfo `json:"location,omitempty"`
	// shared contacts
	Contacts []ContactCard `json:"contacts,omitempty"`
	// an event
	Event *EventInfo `json:"event,omitempty"`
	// buttons, lists and the like from business accounts
	Business *BusinessInfo `json:"business,omitempty"`
}

type PollOption struct {
	Name  string `json:"name"`
	Votes int    `json:"votes"`
	Mine  bool   `json:"mine"`
	// display names, "You" for us
	Voters []string `json:"voters"`
}

type PollInfo struct {
	Name    string       `json:"name"`
	Options []PollOption `json:"options"`
	// how many options one person may pick; 0 = any number
	Selectable  int `json:"selectable"`
	TotalVoters int `json:"totalVoters"`
}

// one entry of the "Deleted & edited" feed
type ChangeItem struct {
	ChatJID  string  `json:"chatJid"`
	ChatName string  `json:"chatName"`
	Message  Message `json:"message"`
	// deleted | edited
	Change string `json:"change"`
	At     int64  `json:"at"`
}

type ChangePage struct {
	Items   []ChangeItem `json:"items"`
	HasMore bool         `json:"hasMore"`
}

type StatusItem struct {
	Message Message `json:"message"`
	// opened in WhatsZori (ghost or not)
	Seen bool `json:"seen"`
	// the colour behind a text status, #rrggbb
	Background string `json:"background,omitempty"`
}

// one person's status updates
type StatusGroup struct {
	JID    string       `json:"jid"`
	Name   string       `json:"name"`
	Mine   bool         `json:"mine"`
	Items  []StatusItem `json:"items"`
	Unseen int          `json:"unseen"`
	LastTS int64        `json:"lastTs"`
}

// a status arrived, changed or was deleted
type StatusUpdateEvent struct {
	JID string `json:"jid"`
}

// a plugin folder in <config>/plugins
type PluginInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Homepage    string `json:"homepage,omitempty"`
	// the module to load, relative to the plugin folder
	Main string `json:"main"`
	// the icon's file, relative to the plugin folder; empty for none
	Icon       string `json:"icon,omitempty"`
	APIVersion int    `json:"apiVersion"`
	// runs in an isolated frame with a declarative UI
	Sandbox bool `json:"sandbox"`
	// what it asks for (a v1 plugin: what the first API gave every plugin)
	Permissions []string        `json:"permissions"`
	Network     []string        `json:"network"`
	Settings    []PluginSetting `json:"settings"`
	Signature   PluginSignature `json:"signature"`
	Enabled     bool            `json:"enabled"`
	// it asks for something the user hasn't allowed yet (new permissions or sites, another
	// signing key); it doesn't run until they do
	NeedsApproval  bool     `json:"needsApproval"`
	NewPermissions []string `json:"newPermissions"`
	NewNetwork     []string `json:"newNetwork"`
	KeyChanged     bool     `json:"keyChanged"`
	// why it can't be loaded (bad manifest, missing file, broken signature); empty when fine
	Error string `json:"error,omitempty"`
}

// one field of the settings form WhatsZori draws for a plugin
type PluginSetting struct {
	Key string `json:"key"`
	// text | password | textarea | toggle | select | number
	Type        string         `json:"type"`
	Label       string         `json:"label"`
	Description string         `json:"description,omitempty"`
	Placeholder string         `json:"placeholder,omitempty"`
	Default     any            `json:"default,omitempty"`
	Options     []PluginOption `json:"options,omitempty"`
	Min         *float64       `json:"min,omitempty"`
	Max         *float64       `json:"max,omitempty"`
}

type PluginOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type PluginSignature struct {
	// unsigned | signed | invalid
	State     string `json:"state"`
	Key       string `json:"key,omitempty"`
	Publisher string `json:"publisher,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// a request a plugin makes through ctx.net.fetch
type PluginFetchRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	// base64
	Body      string `json:"body"`
	TimeoutMs int    `json:"timeoutMs"`
}

type PluginFetchResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	// base64
	Body string `json:"body"`
	URL  string `json:"url"`
}

// a file in a plugin's folder changed
type PluginChangedEvent struct {
	ID string `json:"id"`
}

// a sticker in the picker: id is a file in the stickers folder, or "pk:<n>" for one seen in a chat
type Sticker struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type EditVersion struct {
	Text string `json:"text"`
	At   int64  `json:"at"`
}

type MessagePage struct {
	Messages []Message `json:"messages"`
	HasMore  bool      `json:"hasMore"`
}

type SearchHit struct {
	ChatJID  string  `json:"chatJid"`
	ChatName string  `json:"chatName"`
	Message  Message `json:"message"`
}

type ReadReceiptMode string

const (
	ReadAlways  ReadReceiptMode = "always"
	ReadNever   ReadReceiptMode = "never"
	ReadOnReply ReadReceiptMode = "on-reply"
)

type GhostSettings struct {
	HideOnline   bool            `json:"hideOnline"`
	HideTyping   bool            `json:"hideTyping"`
	ReadReceipts ReadReceiptMode `json:"readReceipts"`
	// don't send "played" when we listen to a voice note
	HidePlayed bool `json:"hidePlayed"`
	// view statuses without telling the poster; when off the UI asks each time
	StatusGhost bool `json:"statusGhost"`
	// chats in full ghost mode: no read or played receipts, no typing, whatever the rest says
	GhostChats []string `json:"ghostChats"`
}

func DefaultGhost() GhostSettings {
	return GhostSettings{ReadReceipts: ReadAlways, GhostChats: []string{}}
}

type Contact struct {
	JID   string `json:"jid"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// History is the "history" part of the frontend's AppSettings, which Go reads to decide what to
// keep. Pointers so a missing key keeps the Go default instead of turning into false.
type History struct {
	KeepDeleted       *bool `json:"keepDeleted"`
	KeepEditHistory   *bool `json:"keepEditHistory"`
	AutoDownloadMedia *bool `json:"autoDownloadMedia"`
}

type HistoryPolicy struct {
	KeepDeleted     bool
	KeepEditHistory bool
	AutoDownload    bool
}

func (h History) Policy() HistoryPolicy {
	or := func(b *bool, def bool) bool {
		if b == nil {
			return def
		}
		return *b
	}
	return HistoryPolicy{
		KeepDeleted:     or(h.KeepDeleted, true),
		KeepEditHistory: or(h.KeepEditHistory, true),
		AutoDownload:    or(h.AutoDownloadMedia, true),
	}
}

// Event payloads. Names live in internal/events.

type ConnStateEvent struct {
	State ConnState `json:"state"`
}

type AuthErrorEvent struct {
	Message string `json:"message"`
}

type MsgBatchEvent struct {
	Messages []Message `json:"messages"`
}

type MsgStatusEvent struct {
	ChatJID string        `json:"chatJid"`
	PK      string        `json:"pk"`
	Status  MessageStatus `json:"status"`
}

type MsgEditedEvent struct {
	ChatJID   string `json:"chatJid"`
	PK        string `json:"pk"`
	Text      string `json:"text"`
	EditedAt  int64  `json:"editedAt"`
	EditCount int    `json:"editCount"`
}

type MsgDeletedEvent struct {
	ChatJID string      `json:"chatJid"`
	PK      string      `json:"pk"`
	Deleted DeletedInfo `json:"deleted"`
	Purged  bool        `json:"purged"`
}

type MsgReactionEvent struct {
	ChatJID   string     `json:"chatJid"`
	PK        string     `json:"pk"`
	Reactions []Reaction `json:"reactions"`
}

type ChatUpdateEvent struct {
	Chat Chat `json:"chat"`
}

// messages deleted on this computer only ("Delete for me")
type MsgRemovedEvent struct {
	ChatJID string   `json:"chatJid"`
	PKs     []string `json:"pks"`
}

// a LID chat that got folded into the phone-number one
type ChatRemovedEvent struct {
	JID string `json:"jid"`
}

// a profile picture or group photo changed; the UI reloads it
type AvatarChangedEvent struct {
	JID string `json:"jid"`
}

// a notification was clicked: open this chat (and focus the composer for "Reply" without a field)
type NotificationOpenEvent struct {
	ChatJID string `json:"chatJid"`
	PK      string `json:"pk"`
	Reply   bool   `json:"reply"`
}

// InAppToast is one WhatsZori-drawn notification, for the toast window.
type InAppToast struct {
	ID      string `json:"id"`
	ChatJID string `json:"chatJid"`
	PK      string `json:"pk"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	// /wz-avatar/... for the chat, empty for summaries and with previews off
	Avatar  string `json:"avatar"`
	IsGroup bool   `json:"isGroup"`
	Actions bool   `json:"actions"`
	At      int64  `json:"at"`
}

type SettingsChangedEvent struct {
	Key string `json:"key"`
}

type PresenceEvent struct {
	JID      string `json:"jid"`
	Online   bool   `json:"online"`
	LastSeen *int64 `json:"lastSeen"`
}

type TypingEvent struct {
	ChatJID    string `json:"chatJid"`
	SenderJID  string `json:"senderJid"`
	SenderName string `json:"senderName"`
	Typing     bool   `json:"typing"`
}

type SyncProgressEvent struct {
	// 0..100; 100 means done
	Progress int  `json:"progress"`
	Done     bool `json:"done"`
}

type ToastEvent struct {
	Kind string `json:"kind"` // error | info
	Text string `json:"text"`
}
