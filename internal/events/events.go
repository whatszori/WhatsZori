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
	// settings were saved (the toast window follows the main window's theme with this)
	SettingsChanged = "wz:settings:changed"
	ToastShow       = "wz:toast:show"
	ToastWithdraw   = "wz:toast:withdraw"
	// a file in a plugin's folder changed (the frontend restarts that plugin if it runs)
	PluginChanged = "wz:plugin:changed"

	AuthQR       = "auth:qr"
	AuthState    = "auth:state"
	AuthError    = "auth:error"
	ConnState    = "conn:state"
	MsgBatch     = "msg:batch"
	MsgStatus    = "msg:status"
	MsgEdited    = "msg:edited"
	MsgDeleted   = "msg:deleted"
	MsgReaction  = "msg:reaction"
	MsgRemoved   = "msg:removed"
	ChatUpdate   = "chat:update"
	ChatRemoved  = "chat:removed"
	AvatarChange = "avatar:changed"
	ChatCleared  = "chat:cleared"
	ExportProg   = "export:progress"
	NotifyOpen   = "notification:open"
	Presence     = "presence"
	ChatTyping   = "chat:typing"
	StatusUpdate = "status:update"
	SyncProgress = "sync:progress"
	Toast        = "toast"
	// a chat's scheduled messages changed (added, sent, failed, deleted)
	ScheduledChanged = "scheduled:changed"
)

// All lists every event name, for the sync test.
var All = []string{
	SystemThemeChanged, ThemeChanged, SettingsChanged, ToastShow, ToastWithdraw, PluginChanged,
	AuthQR, AuthState, AuthError, ConnState, MsgBatch, MsgStatus, MsgEdited, MsgDeleted, MsgReaction, MsgRemoved,
	ChatUpdate, ChatRemoved, AvatarChange, ChatCleared, ExportProg, NotifyOpen, Presence, ChatTyping, StatusUpdate, SyncProgress, Toast,
	ScheduledChanged,
}

func init() {
	// registered events are type-checked on emit, and the binding generator sees them
	application.RegisterEvent[systheme.SystemPalette](SystemThemeChanged)
	application.RegisterEvent[themes.Changed](ThemeChanged)
	application.RegisterEvent[domain.SettingsChangedEvent](SettingsChanged)
	application.RegisterEvent[domain.InAppToast](ToastShow)
	application.RegisterEvent[domain.ChatRemovedEvent](ToastWithdraw)
	application.RegisterEvent[domain.PluginChangedEvent](PluginChanged)
	application.RegisterEvent[domain.QRPayload](AuthQR)
	application.RegisterEvent[domain.AuthStatus](AuthState)
	application.RegisterEvent[domain.AuthErrorEvent](AuthError)
	application.RegisterEvent[domain.ConnStateEvent](ConnState)
	application.RegisterEvent[domain.MsgBatchEvent](MsgBatch)
	application.RegisterEvent[domain.MsgStatusEvent](MsgStatus)
	application.RegisterEvent[domain.MsgEditedEvent](MsgEdited)
	application.RegisterEvent[domain.MsgDeletedEvent](MsgDeleted)
	application.RegisterEvent[domain.MsgReactionEvent](MsgReaction)
	application.RegisterEvent[domain.MsgRemovedEvent](MsgRemoved)
	application.RegisterEvent[domain.ChatUpdateEvent](ChatUpdate)
	application.RegisterEvent[domain.ChatRemovedEvent](ChatRemoved)
	application.RegisterEvent[domain.AvatarChangedEvent](AvatarChange)
	application.RegisterEvent[domain.ChatRemovedEvent](ChatCleared)
	application.RegisterEvent[domain.ExportProgressEvent](ExportProg)
	application.RegisterEvent[domain.NotificationOpenEvent](NotifyOpen)
	application.RegisterEvent[domain.PresenceEvent](Presence)
	application.RegisterEvent[domain.TypingEvent](ChatTyping)
	application.RegisterEvent[domain.StatusUpdateEvent](StatusUpdate)
	application.RegisterEvent[domain.SyncProgressEvent](SyncProgress)
	application.RegisterEvent[domain.ToastEvent](Toast)
	application.RegisterEvent[domain.ScheduledChangedEvent](ScheduledChanged)
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
