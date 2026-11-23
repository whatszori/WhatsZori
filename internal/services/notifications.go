package services

import "github.com/whatszori/WhatsZori/internal/core"

// Notifications is what Settings → Notifications needs; the rules themselves live in
// internal/notify and the on/off switches in AppSettings.
type Notifications struct{ c *core.Core }

func NewNotifications(c *core.Core) *Notifications { return &Notifications{c: c} }

// Available is false on a Linux desktop without a notification daemon.
func (n *Notifications) Available() bool { return n.c.NotificationsAvailable() }

func (n *Notifications) Test() error { return n.c.TestNotification() }
