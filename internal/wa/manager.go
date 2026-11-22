package wa

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/redact"
)

// Factory makes a client for the device in session.db, or for a fresh device when there's none.
type Factory func(ctx context.Context) (Client, PresenceTransport, error)

type Emitter interface {
	Emit(name string, data any)
}

// Event names the manager emits. They match internal/events; duplicated here as plain strings so
// wa doesn't import the Wails registration.
const (
	evAuthQR    = "auth:qr"
	evAuthState = "auth:state"
	evAuthError = "auth:error"
	evConnState = "conn:state"
	evToast     = "toast"
)

// Hooks connect the manager to the rest of the app. Event runs synchronously on whatsmeow's event
// goroutine; returning an error makes whatsmeow skip the ack, so the server redelivers.
type Hooks struct {
	Event       func(evt any) error
	Connected   func(cli Client)
	LoggedOut   func()
	ClientReady func(cli Client, pt PresenceTransport)
}

var (
	ErrNoConnect     = errors.New("connecting to WhatsApp is turned off (WHATSZORI_NO_CONNECT is set)")
	ErrLoggedIn      = errors.New("already logged in")
	ErrNotLoggedIn   = errors.New("not logged in")
	ErrNotConnected  = errors.New("not connected to WhatsApp right now")
	errQRUnavailable = errors.New("couldn't get a login code from WhatsApp, try again")
)

type Manager struct {
	factory   Factory
	emit      Emitter
	hooks     Hooks
	noConnect bool
	log       *slog.Logger

	mu        sync.Mutex
	cli       Client
	pt        PresenceTransport
	handlerID uint32
	auth      domain.AuthState
	conn      domain.ConnState
	qrCancel  context.CancelFunc
	firstQR   chan struct{}
	pairing   bool
	stopped   bool
}

type Options struct {
	Factory Factory
	Emit    Emitter
	Hooks   Hooks
	// NoConnect keeps the client offline. Used for smoke tests of the built app, where nobody is
	// there to log in and we must not talk to WhatsApp.
	NoConnect bool
	Log       *slog.Logger
}

func NewManager(o Options) *Manager {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return &Manager{
		factory:   o.Factory,
		emit:      o.Emit,
		hooks:     o.Hooks,
		noConnect: o.NoConnect,
		log:       o.Log,
		auth:      domain.AuthLoggedOut,
		conn:      domain.ConnOffline,
	}
}

// Start creates the client and connects in the background when a session exists.
func (m *Manager) Start(ctx context.Context) error {
	if err := m.newClient(ctx); err != nil {
		return err
	}
	m.mu.Lock()
	cli := m.cli
	loggedIn := !cli.OwnID().IsEmpty()
	if loggedIn {
		m.auth = domain.AuthLoggedIn
		m.conn = domain.ConnConnecting
	}
	m.mu.Unlock()
	if loggedIn {
		m.emitAuth()
		m.emitConn()
		if m.noConnect {
			m.setConn(domain.ConnOffline)
			return nil
		}
		go func() {
			if err := cli.Connect(); err != nil {
				m.log.Warn("connect failed", "error", redact.Digits(err.Error()))
				m.setConn(domain.ConnOffline)
			}
		}()
	}
	return nil
}

func (m *Manager) Stop() {
	m.mu.Lock()
	m.stopped = true
	cli := m.cli
	if m.qrCancel != nil {
		m.qrCancel()
	}
	m.mu.Unlock()
	if cli != nil {
		cli.Disconnect()
	}
}

func (m *Manager) newClient(ctx context.Context) error {
	cli, pt, err := m.factory(ctx)
	if err != nil {
		return fmt.Errorf("create whatsapp client: %w", err)
	}
	m.mu.Lock()
	if m.cli != nil {
		m.cli.RemoveEventHandler(m.handlerID)
	}
	m.cli, m.pt = cli, pt
	m.handlerID = cli.AddEventHandler(m.handle)
	m.mu.Unlock()
	if m.hooks.ClientReady != nil {
		m.hooks.ClientReady(cli, pt)
	}
	return nil
}

func (m *Manager) Client() Client {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cli
}

func (m *Manager) Conn() domain.ConnState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.conn
}

func (m *Manager) Status() domain.AuthStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() domain.AuthStatus {
	st := domain.AuthStatus{State: m.auth}
	if m.auth == domain.AuthLoggedIn && m.cli != nil {
		id := m.cli.OwnID()
		st.Me = &domain.Me{JID: id.String(), Name: m.cli.PushName(), Phone: "+" + id.User}
	}
	return st
}

// Ready returns the client when we're logged in and connected, for anything that sends.
func (m *Manager) Ready() (Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.auth != domain.AuthLoggedIn || m.cli == nil {
		return nil, ErrNotLoggedIn
	}
	if !m.cli.IsConnected() {
		return nil, ErrNotConnected
	}
	return m.cli, nil
}

func (m *Manager) setAuth(s domain.AuthState) {
	m.mu.Lock()
	changed := m.auth != s
	m.auth = s
	m.mu.Unlock()
	if changed {
		m.emitAuth()
	}
}

func (m *Manager) setConn(s domain.ConnState) {
	m.mu.Lock()
	changed := m.conn != s
	m.conn = s
	m.mu.Unlock()
	if changed {
		m.emitConn()
	}
}

func (m *Manager) emitAuth() { m.emit.Emit(evAuthState, m.Status()) }
func (m *Manager) emitConn() { m.emit.Emit(evConnState, domain.ConnStateEvent{State: m.Conn()}) }

func (m *Manager) authError(msg string) {
	m.emit.Emit(evAuthError, domain.AuthErrorEvent{Message: msg})
}

func (m *Manager) toast(kind, text string) {
	m.emit.Emit(evToast, domain.ToastEvent{Kind: kind, Text: text})
}

// StartQR opens the login socket and streams QR codes as auth:qr events. Calling it again while
// codes are already coming just re-sends the state.
func (m *Manager) StartQR(ctx context.Context) error {
	if m.noConnect {
		return ErrNoConnect
	}
	m.mu.Lock()
	if m.auth == domain.AuthLoggedIn {
		m.mu.Unlock()
		return ErrLoggedIn
	}
	if m.qrCancel != nil {
		m.mu.Unlock()
		m.emitAuth()
		return nil
	}
	cli := m.cli
	m.mu.Unlock()

	if cli.IsConnected() {
		cli.Disconnect()
	}
	// not tied to ctx: the Wails call returns right away, the codes keep coming
	qctx, cancel := context.WithCancel(context.Background())
	ch, err := cli.GetQRChannel(qctx)
	if err != nil {
		cancel()
		if errors.Is(err, whatsmeow.ErrQRStoreContainsID) {
			return ErrLoggedIn
		}
		return err
	}
	m.mu.Lock()
	m.qrCancel = cancel
	m.firstQR = make(chan struct{})
	m.pairing = false
	m.mu.Unlock()

	if err := cli.Connect(); err != nil {
		cancel()
		m.mu.Lock()
		m.qrCancel = nil
		m.mu.Unlock()
		m.log.Warn("qr connect failed", "error", redact.Digits(err.Error()))
		return fmt.Errorf("couldn't reach WhatsApp: %w", err)
	}
	m.setAuth(domain.AuthQR)
	m.setConn(domain.ConnConnecting)
	go m.qrLoop(ch)
	return nil
}

func (m *Manager) qrLoop(ch <-chan whatsmeow.QRChannelItem) {
	first := true
	for item := range ch {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			m.emit.Emit(evAuthQR, domain.QRPayload{Code: item.Code, ExpiresIn: item.Timeout.Milliseconds()})
			if first {
				first = false
				m.mu.Lock()
				close(m.firstQR)
				m.mu.Unlock()
			}
		case whatsmeow.QRChannelSuccess.Event:
			m.setAuth(domain.AuthLoggingIn)
		case whatsmeow.QRChannelTimeout.Event:
			m.endLogin("The login code expired. Get a new one to try again.")
		case whatsmeow.QRChannelEventError:
			msg := "Linking failed"
			if item.Error != nil {
				m.log.Warn("pair error", "error", redact.Digits(item.Error.Error()))
			}
			m.endLogin(msg + ". Try again.")
		case whatsmeow.QRChannelClientOutdated.Event:
			m.endLogin("WhatsApp says this client is outdated. Update WhatsZori and try again.")
		case whatsmeow.QRChannelScannedWithoutMultidevice.Event:
			m.endLogin("Turn on multi-device on your phone and scan again.")
		default:
			if strings.HasPrefix(item.Event, "err-") {
				m.endLogin("Linking failed. Try again.")
			}
		}
	}
	m.mu.Lock()
	m.qrCancel = nil
	m.mu.Unlock()
}

func (m *Manager) endLogin(msg string) {
	m.mu.Lock()
	if m.qrCancel != nil {
		m.qrCancel()
	}
	cli := m.cli
	state := m.auth
	m.mu.Unlock()
	if state == domain.AuthLoggedIn {
		return
	}
	cli.Disconnect()
	m.setAuth(domain.AuthLoggedOut)
	m.setConn(domain.ConnOffline)
	m.authError(msg)
}

// PairPhone returns the 8-character code to type on the phone. The login socket has to be open
// and past its first QR code before WhatsApp accepts a pairing request.
func (m *Manager) PairPhone(ctx context.Context, phone string) (string, error) {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if len(digits) < 8 {
		return "", errors.New("phone number looks too short")
	}
	if err := m.StartQR(ctx); err != nil {
		return "", err
	}
	m.mu.Lock()
	first, cli := m.firstQR, m.cli
	m.mu.Unlock()
	select {
	case <-first:
	case <-time.After(30 * time.Second):
		return "", errQRUnavailable
	case <-ctx.Done():
		return "", ctx.Err()
	}
	code, err := cli.PairPhone(ctx, digits)
	if err != nil {
		m.log.Warn("pair phone failed", "error", redact.Digits(err.Error()))
		return "", fmt.Errorf("WhatsApp didn't accept the number: %w", err)
	}
	m.mu.Lock()
	m.pairing = true
	m.mu.Unlock()
	m.setAuth(domain.AuthPairing)
	return code, nil
}

// Logout unlinks this device. Our own database stays unless the caller wipes it.
func (m *Manager) Logout(ctx context.Context) error {
	m.mu.Lock()
	cli := m.cli
	if m.qrCancel != nil {
		m.qrCancel()
	}
	m.mu.Unlock()
	var err error
	if cli.IsConnected() && cli.IsLoggedIn() {
		err = cli.Logout(ctx)
	}
	if err != nil || !cli.IsLoggedIn() {
		// offline, or the server call failed: at least forget the keys locally
		if derr := cli.DeleteSession(ctx); derr != nil && err == nil {
			err = derr
		}
	}
	cli.Disconnect()
	m.afterLogout(ctx)
	if err != nil {
		m.log.Warn("logout", "error", redact.Digits(err.Error()))
	}
	return nil
}

func (m *Manager) afterLogout(ctx context.Context) {
	if err := m.newClient(ctx); err != nil {
		m.log.Error("new client after logout", "error", err)
	}
	m.setConn(domain.ConnOffline)
	m.setAuth(domain.AuthLoggedOut)
	if m.hooks.LoggedOut != nil {
		m.hooks.LoggedOut()
	}
}

func (m *Manager) handle(evt any) bool {
	switch e := evt.(type) {
	case *events.Connected:
		m.mu.Lock()
		cli := m.cli
		m.mu.Unlock()
		m.setAuth(domain.AuthLoggedIn)
		m.setConn(domain.ConnConnected)
		// auth:state again so the frontend gets our push name, which arrives with the connection
		m.emitAuth()
		if m.hooks.Connected != nil {
			go m.hooks.Connected(cli)
		}
	case *events.PairSuccess:
		m.setAuth(domain.AuthLoggingIn)
	case *events.Disconnected:
		if m.Status().State == domain.AuthLoggedIn {
			m.setConn(domain.ConnReconnecting)
		}
	case *events.KeepAliveTimeout:
		if e.ErrorCount >= 2 {
			m.setConn(domain.ConnReconnecting)
		}
	case *events.KeepAliveRestored:
		m.setConn(domain.ConnConnected)
	case *events.StreamReplaced:
		m.setConn(domain.ConnOffline)
		m.toast("error", "This session was opened in another WhatsZori window or device. Restart WhatsZori to reconnect here.")
	case *events.LoggedOut:
		// whatsmeow already deleted the keys; swap the client outside the handler (removing a
		// handler from inside one deadlocks)
		go func() {
			m.afterLogout(context.Background())
			m.toast("info", "This device was logged out from your phone. Your local history is still here.")
		}()
	case *events.TemporaryBan:
		m.setConn(domain.ConnOffline)
		m.toast("error", "WhatsApp temporarily banned this account: "+e.String())
	case *events.ConnectFailure:
		m.setConn(domain.ConnOffline)
		m.log.Warn("connect failure", "reason", e.Reason.String())
	case *events.ClientOutdated:
		m.setConn(domain.ConnOffline)
		m.toast("error", "WhatsApp says this client is outdated. Update WhatsZori to reconnect.")
	}
	if m.hooks.Event == nil {
		return true
	}
	if err := m.hooks.Event(evt); err != nil {
		m.log.Error("handle event", "type", fmt.Sprintf("%T", evt), "error", redact.Digits(err.Error()))
		return false
	}
	return true
}
