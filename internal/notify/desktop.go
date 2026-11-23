package notify

import "context"

type Action string

const (
	// the notification body was clicked
	ActionOpen Action = "open"
	// "Mark as read"
	ActionRead Action = "read"
	// a reply: Text is set where the desktop has an input field (Windows, KDE); without one
	// (GNOME) it's empty and the app opens the chat with the composer focused
	ActionReply Action = "reply"
)

type Response struct {
	Chat   string
	PK     string
	Action Action
	Text   string
}

// Desktop shows notifications on one platform.
type Desktop interface {
	Start(ctx context.Context) error
	Show(t Toast) error
	// Withdraw takes down a chat's notification once the chat is opened, where the platform can
	Withdraw(chat string)
	OnResponse(fn func(Response))
	// Available is false when there's nothing to talk to (no notification daemon on Linux)
	Available() bool
	Close()
}

// Nop is used when no desktop is wired up yet (tests, early startup).
type Nop struct{}

func (Nop) Start(context.Context) error { return nil }
func (Nop) Show(Toast) error            { return nil }
func (Nop) Withdraw(string)             {}
func (Nop) OnResponse(func(Response))   {}
func (Nop) Available() bool             { return false }
func (Nop) Close()                      {}
