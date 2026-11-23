package core

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/notify"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// NotifySettings is "notifications" in AppSettings; pointers so a missing key means on.
type notifySettings struct {
	Enabled *bool `json:"enabled"`
	Preview *bool `json:"preview"`
	Sound   *bool `json:"sound"`
	// auto, system or whatszori
	Style string `json:"style"`
}

func (c *Core) notifySettings() notify.Settings {
	var s struct {
		Notifications notifySettings `json:"notifications"`
	}
	c.settings.Decode(KeyApp, &s)
	on := func(b *bool) bool { return b == nil || *b }
	n := s.Notifications
	return notify.Settings{Enabled: on(n.Enabled), Preview: on(n.Preview), Sound: on(n.Sound)}
}

// CustomToasts reports whether notifications should be WhatsZori's own window rather than the
// system's. "auto" means ours on Windows (its toasts can't be styled), the system's elsewhere.
func (c *Core) CustomToasts(isWindows bool) bool {
	var s struct {
		Notifications notifySettings `json:"notifications"`
	}
	c.settings.Decode(KeyApp, &s)
	switch s.Notifications.Style {
	case "system":
		return false
	case "whatszori":
		return true
	}
	return isWindows
}

// SetDesktop plugs in the platform's notifications and starts them. focused reports whether the
// window has focus; show brings the window up when a notification is clicked.
func (c *Core) SetDesktop(ctx context.Context, d notify.Desktop, focused func() bool, show func()) {
	c.mu.Lock()
	c.desktop, c.focused, c.showWindow = d, focused, show
	c.mu.Unlock()
	d.OnResponse(c.onNotification)
	if err := d.Start(ctx); err != nil {
		c.log.Warn("desktop notifications unavailable", "error", err)
	}
}

func (c *Core) currentDesktop() notify.Desktop {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.desktop == nil {
		return notify.Nop{}
	}
	return c.desktop
}

func (c *Core) isFocused() bool {
	c.mu.Lock()
	f := c.focused
	c.mu.Unlock()
	return f != nil && f()
}

func (c *Core) newNotifyCenter() *notify.Center {
	return notify.New(notify.Options{
		Send:     func(t notify.Toast) error { return c.currentDesktop().Show(t) },
		Withdraw: func(chat string) { c.currentDesktop().Withdraw(chat) },
		Settings: c.notifySettings,
		Focused:  c.isFocused,
		Avatar:   c.Avatars.Cached,
	})
}

// NotificationsAvailable is false when the OS has nowhere to show them.
func (c *Core) NotificationsAvailable() bool { return c.currentDesktop().Available() }

func (c *Core) TestNotification() error {
	d := c.currentDesktop()
	if !d.Available() {
		return fmt.Errorf("this desktop has no notification service")
	}
	return d.Show(notify.Toast{ID: fmt.Sprintf("wz-test-%d", time.Now().UnixMilli()), Title: "WhatsZori",
		Body: "Notifications work. This is what a new message looks like.", Silent: !c.notifySettings().Sound})
}

func (c *Core) onNotification(r notify.Response) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	switch r.Action {
	case notify.ActionRead:
		if r.Chat == "" {
			return
		}
		if err := c.MarkChatRead(ctx, r.Chat); err != nil {
			c.log.Warn("mark read from notification", "error", redact.Digits(err.Error()))
		}
	case notify.ActionReply:
		if strings.TrimSpace(r.Text) == "" {
			// no input field on this desktop (GNOME): open the chat ready to type
			c.openFromNotification(r, true)
			return
		}
		if _, err := c.Sender.SendText(ctx, r.Chat, r.Text, 0); err != nil {
			c.Notify.Error("Not sent: " + err.Error())
			return
		}
		c.Notify.Seen(r.Chat)
	default:
		c.openFromNotification(r, false)
	}
}

func (c *Core) openFromNotification(r notify.Response, reply bool) {
	c.mu.Lock()
	show := c.showWindow
	c.mu.Unlock()
	if show != nil {
		show()
	}
	if r.Chat != "" {
		c.Emit.Emit(events.NotifyOpen, domain.NotificationOpenEvent{ChatJID: r.Chat, PK: r.PK, Reply: reply})
	}
}

// MarkChatRead is "the user has seen this chat": the local unread count clears, the privacy gate
// decides whether WhatsApp hears about it, and its notification goes away.
func (c *Core) MarkChatRead(ctx context.Context, jid string) error {
	row, err := repo.GetChat(ctx, c.DB, jid)
	if err != nil {
		return err
	}
	if row.Unread > 0 {
		if err := repo.SetUnread(ctx, c.DB, jid, 0); err != nil {
			return err
		}
		if dto, err := c.View(ctx).Chat(ctx, c.DB, row); err == nil {
			dto.Unread = 0
			c.Emit.Emit(events.ChatUpdate, domain.ChatUpdateEvent{Chat: dto})
		}
	}
	c.Notify.Seen(jid)
	j, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	if cli, err := c.Mgr.Ready(); err == nil {
		if err := c.Gate.ChatOpened(ctx, j); err != nil {
			return fmt.Errorf("read receipts: %w", err)
		}
		if !row.IsGroup {
			// presence only flows for contacts we subscribed to
			_ = cli.SubscribePresence(ctx, j)
		}
	}
	return nil
}
