package app

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/notify"
)

// toastWindow is WhatsZori's own notification popup: a small frameless window in the bottom-right
// corner that runs the same frontend (?window=toast), so themes and plugins restyle it like the
// rest of the app. It never takes focus by itself; see toasts_windows.go.
type toastWindow struct {
	a *App

	mu        sync.Mutex
	win       *application.WebviewWindow
	ready     bool
	queue     []domain.InAppToast
	fn        func(notify.Response)
	visible   bool
	shownOnce bool
}

const (
	// the card is 360 wide; the rest is room for its shadow
	toastWidth  = 372
	toastMargin = 8
)

func newToastWindow(a *App) *toastWindow { return &toastWindow{a: a} }

// create makes the (hidden) window; Windows only, elsewhere the system's notifications are used.
func (t *toastWindow) create() {
	if !customToastsSupported {
		return
	}
	t.win = t.a.wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "toasts",
		Title:            "WhatsZori notifications",
		Width:            toastWidth,
		Height:           120,
		URL:              "/?window=toast",
		Frameless:        true,
		AlwaysOnTop:      true,
		Hidden:           true,
		DisableResize:    true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Windows: application.WindowsWindow{
			HiddenOnTaskbar: true,
			// Windows 11 would draw its own border, corners and shadow around the whole window,
			// transparent padding included; the card draws its own
			DisableFramelessWindowDecorations: true,
		},
	})
}

func (t *toastWindow) Start(context.Context) error { return nil }

func (t *toastWindow) Available() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.win != nil
}

func (t *toastWindow) OnResponse(fn func(notify.Response)) {
	t.mu.Lock()
	t.fn = fn
	t.mu.Unlock()
}

func (t *toastWindow) Show(n notify.Toast) error {
	p := domain.InAppToast{ID: n.ID, ChatJID: n.Chat, PK: n.PK, Title: n.Title, Body: n.Body,
		IsGroup: n.Group, Actions: n.Actions, At: time.Now().UnixMilli()}
	if n.Avatar != "" && n.Chat != "" {
		p.Avatar = "/wz-avatar/" + url.PathEscape(n.Chat)
	}
	if !n.Silent {
		playNotificationSound()
	}
	t.mu.Lock()
	if !t.ready {
		// the page hasn't loaded yet; it picks these up with Ready()
		t.queue = append(t.queue, p)
		t.mu.Unlock()
		return nil
	}
	t.mu.Unlock()
	events.Wails{}.Emit(events.ToastShow, p)
	return nil
}

func (t *toastWindow) Withdraw(chat string) {
	events.Wails{}.Emit(events.ToastWithdraw, domain.ChatRemovedEvent{JID: chat})
}

func (t *toastWindow) Close() {}

// place puts the window in the bottom-right corner of the primary screen's work area.
func (t *toastWindow) place(height int) {
	var area application.Rect
	for _, s := range t.a.wails.Screen.GetAll() {
		if s.IsPrimary || area.Width == 0 {
			area = s.WorkArea
		}
	}
	if area.Width == 0 {
		return
	}
	t.win.SetSize(toastWidth, height)
	t.win.SetPosition(area.X+area.Width-toastWidth-toastMargin, area.Y+area.Height-height-toastMargin)
}

// Toasts is what the toast window's page calls.
type Toasts struct{ t *toastWindow }

// Ready is the page saying it's listening; it gets whatever came in before.
func (s *Toasts) Ready() []domain.InAppToast {
	s.t.mu.Lock()
	defer s.t.mu.Unlock()
	s.t.ready = true
	q := s.t.queue
	s.t.queue = nil
	if q == nil {
		q = []domain.InAppToast{}
	}
	return q
}

// Resize fits the window to the stack of cards (in CSS px); 0 hides it.
func (s *Toasts) Resize(height int) {
	t := s.t
	if t.win == nil {
		return
	}
	if height <= 0 {
		t.mu.Lock()
		was := t.visible
		t.visible = false
		t.mu.Unlock()
		if was {
			application.InvokeAsync(func() { hideToastWindow(t.win) })
		}
		return
	}
	height = min(height, 900)
	application.InvokeAsync(func() {
		t.place(height)
		t.mu.Lock()
		first := !t.shownOnce
		t.shownOnce, t.visible = true, true
		t.mu.Unlock()
		showToastWindow(t.win, first)
	})
}

// Act is a click on a card or one of its buttons.
func (s *Toasts) Act(chat, pk, action, text string) error {
	a := notify.Action(action)
	switch a {
	case notify.ActionOpen, notify.ActionRead, notify.ActionReply:
	default:
		return fmt.Errorf("unknown action %q", action)
	}
	s.t.mu.Lock()
	fn := s.t.fn
	s.t.mu.Unlock()
	if fn != nil {
		go fn(notify.Response{Chat: chat, PK: pk, Action: a, Text: text})
	}
	return nil
}

// Activate lets the window take keyboard focus, for typing a reply. Until then it never
// activates, so a notification doesn't pull focus out of whatever the user is doing.
func (s *Toasts) Activate() {
	if s.t.win == nil {
		return
	}
	application.InvokeAsync(func() { activateToastWindow(s.t.win) })
}

// Deactivate goes back to never taking focus (the reply was sent or cancelled).
func (s *Toasts) Deactivate() {
	if s.t.win == nil {
		return
	}
	application.InvokeAsync(func() { deactivateToastWindow(s.t.win) })
}
