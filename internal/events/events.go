package events

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/systheme"
	"github.com/whatszori/WhatsZori/internal/themes"
)

// Keep in sync with frontend/src/api/events.ts (events_test.go checks the names).
const (
	SystemThemeChanged = "wz:systheme:changed"
	ThemeChanged       = "wz:theme:changed"

	AuthQR       = "auth:qr"
	AuthState    = "auth:state"
	AuthError    = "auth:error"
	ConnState    = "conn:state"
	MsgBatch     = "msg:batch"
	MsgStatus    = "msg:status"
	MsgEdited    = "msg:edited"
	MsgDeleted   = "msg:deleted"
	MsgReaction  = "msg:reaction"
	ChatUpdate   = "chat:update"
	ChatRemoved  = "chat:removed"
	AvatarChange = "avatar:changed"
	ChatCleared  = "chat:cleared"
	ExportProg   = "export:progress"
	Presence     = "presence"
	ChatTyping   = "chat:typing"
	SyncProgress = "sync:progress"
	Toast        = "toast"
)

// All lists every event name, for the sync test.
var All = []string{
	SystemThemeChanged, ThemeChanged,
	AuthQR, AuthState, AuthError, ConnState, MsgBatch, MsgStatus, MsgEdited, MsgDeleted, MsgReaction,
	ChatUpdate, ChatRemoved, AvatarChange, ChatCleared, ExportProg, Presence, ChatTyping, SyncProgress, Toast,
}

func init() {
	// registered events are type-checked on emit, and the binding generator sees them
	application.RegisterEvent[systheme.SystemPalette](SystemThemeChanged)
	application.RegisterEvent[themes.Changed](ThemeChanged)
	application.RegisterEvent[domain.QRPayload](AuthQR)
	application.RegisterEvent[domain.AuthStatus](AuthState)
	application.RegisterEvent[domain.AuthErrorEvent](AuthError)
	application.RegisterEvent[domain.ConnStateEvent](ConnState)
	application.RegisterEvent[domain.MsgBatchEvent](MsgBatch)
	application.RegisterEvent[domain.MsgStatusEvent](MsgStatus)
	application.RegisterEvent[domain.MsgEditedEvent](MsgEdited)
	application.RegisterEvent[domain.MsgDeletedEvent](MsgDeleted)
	application.RegisterEvent[domain.MsgReactionEvent](MsgReaction)
	application.RegisterEvent[domain.ChatUpdateEvent](ChatUpdate)
	application.RegisterEvent[domain.ChatRemovedEvent](ChatRemoved)
	application.RegisterEvent[domain.AvatarChangedEvent](AvatarChange)
	application.RegisterEvent[domain.ChatRemovedEvent](ChatCleared)
	application.RegisterEvent[domain.ExportProgressEvent](ExportProg)
	application.RegisterEvent[domain.PresenceEvent](Presence)
	application.RegisterEvent[domain.TypingEvent](ChatTyping)
	application.RegisterEvent[domain.SyncProgressEvent](SyncProgress)
	application.RegisterEvent[domain.ToastEvent](Toast)
}

type Emitter interface {
	Emit(name string, data any)
}

// Wails emits through the running application. Before Run (or in tests) there's no app, and the
// event is dropped, which is fine since nothing could be listening yet.
type Wails struct{}

func (Wails) Emit(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}

type Discard struct{}

func (Discard) Emit(string, any) {}
