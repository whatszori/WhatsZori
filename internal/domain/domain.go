// Package domain holds the DTOs the frontend sees. They mirror frontend/src/api/types.ts; the
// frontend never gets protobufs or whatsmeow types.
package domain

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
	// presence comes through its own event; these stay empty in snapshots
	LastSeen *int64 `json:"lastSeen,omitempty"`
	Online   bool   `json:"online,omitempty"`
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
	Reactions      []Reaction    `json:"reactions"`
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
}

func DefaultGhost() GhostSettings { return GhostSettings{ReadReceipts: ReadAlways} }

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

// a LID chat that got folded into the phone-number one
type ChatRemovedEvent struct {
	JID string `json:"jid"`
}

// a profile picture or group photo changed; the UI reloads it
type AvatarChangedEvent struct {
	JID string `json:"jid"`
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
