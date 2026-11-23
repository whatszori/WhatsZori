package notify

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// Wails shows toasts through Wails' notification service: Windows toasts (and macOS, untested).
// Windows can't replace or remove a toast once shown, so every batch is a new one; the title
// carries the running count instead.
type Wails struct {
	NS *notifications.NotificationService

	mu sync.Mutex
	fn func(Response)
}

const (
	messageCategory = "wz-message"
	// Wails' id for the reply button of a category with a reply field
	wailsReply = "TEXT_REPLY"
)

func NewWails() *Wails {
	w := &Wails{NS: notifications.New()}
	w.NS.OnNotificationResponse(w.handle)
	return w
}

// Start registers the "message" toast layout. The Wails service must already be running (it is
// started by the app as a regular service).
func (w *Wails) Start(context.Context) error {
	return w.NS.RegisterNotificationCategory(notifications.NotificationCategory{
		ID:               messageCategory,
		Actions:          []notifications.NotificationAction{{ID: string(ActionRead), Title: "Mark as read"}},
		HasReplyField:    true,
		ReplyPlaceholder: "Reply…",
		ReplyButtonTitle: "Send",
	})
}

func (w *Wails) Available() bool { return true }

func (w *Wails) OnResponse(fn func(Response)) {
	w.mu.Lock()
	w.fn = fn
	w.mu.Unlock()
}

func (w *Wails) Show(t Toast) error {
	o := notifications.NotificationOptions{
		ID:    t.ID,
		Title: t.Title,
		Body:  t.Body,
		Data:  map[string]any{"chat": t.Chat, "pk": t.PK},
	}
	if t.Silent {
		o.Sound = &notifications.NotificationSound{Silent: true}
	}
	if t.Avatar != "" {
		o.Attachments = []notifications.NotificationAttachment{{Path: t.Avatar, Type: "appLogoOverride"}}
	}
	if t.Actions {
		o.CategoryID = messageCategory
		return w.NS.SendNotificationWithActions(o)
	}
	return w.NS.SendNotification(o)
}

func (w *Wails) Withdraw(string) {}

func (w *Wails) Close() {}

func (w *Wails) handle(r notifications.NotificationResult) {
	if r.Error != nil {
		return
	}
	w.mu.Lock()
	fn := w.fn
	w.mu.Unlock()
	if fn == nil {
		return
	}
	str := func(k string) string {
		v, _ := r.Response.UserInfo[k].(string)
		return v
	}
	resp := Response{Chat: str("chat"), PK: str("pk"), Action: ActionOpen}
	switch r.Response.ActionIdentifier {
	case string(ActionRead):
		resp.Action = ActionRead
	case wailsReply:
		resp.Action, resp.Text = ActionReply, r.Response.UserText
	}
	fn(resp)
}
