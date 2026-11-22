package wa

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/whatszori/WhatsZori/internal/domain"
)

type lifeClient struct {
	Client
	mu        sync.Mutex
	id        types.JID
	connected bool
	connects  int
	qr        chan whatsmeow.QRChannelItem
	handler   func(any) bool
}

func (c *lifeClient) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connects++
	c.connected = true
	return nil
}
func (c *lifeClient) Disconnect() {
	c.mu.Lock()
	c.connected = false
	c.mu.Unlock()
}
func (c *lifeClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}
func (c *lifeClient) IsLoggedIn() bool { return !c.id.IsEmpty() }
func (c *lifeClient) OwnID() types.JID { return c.id }
func (c *lifeClient) PushName() string { return "Me" }
func (c *lifeClient) GetQRChannel(context.Context) (<-chan whatsmeow.QRChannelItem, error) {
	return c.qr, nil
}
func (c *lifeClient) AddEventHandler(fn func(any) bool) uint32 { c.handler = fn; return 1 }
func (c *lifeClient) RemoveEventHandler(uint32) bool           { return true }

type evRec struct {
	mu  sync.Mutex
	evs []string
	all []any
}

func (r *evRec) Emit(name string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.evs = append(r.evs, name)
	r.all = append(r.all, data)
}

func (r *evRec) has(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.evs {
		if e == name {
			return true
		}
	}
	return false
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestQRFlow(t *testing.T) {
	cli := &lifeClient{qr: make(chan whatsmeow.QRChannelItem, 4)}
	rec := &evRec{}
	m := NewManager(Options{Factory: func(context.Context) (Client, PresenceTransport, error) { return cli, nil, nil }, Emit: rec})
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cli.connects != 0 || m.Status().State != domain.AuthLoggedOut {
		t.Fatal("connected without a session")
	}
	if err := m.StartQR(context.Background()); err != nil {
		t.Fatal(err)
	}
	cli.qr <- whatsmeow.QRChannelItem{Event: whatsmeow.QRChannelEventCode, Code: "2@abc", Timeout: 60 * time.Second}
	waitFor(t, func() bool { return rec.has(evAuthQR) })
	if m.Status().State != domain.AuthQR {
		t.Errorf("state %s, want qr", m.Status().State)
	}
	cli.qr <- whatsmeow.QRChannelTimeout
	close(cli.qr)
	waitFor(t, func() bool { return rec.has(evAuthError) })
	if m.Status().State != domain.AuthLoggedOut || cli.IsConnected() {
		t.Errorf("after timeout: %s connected=%v", m.Status().State, cli.IsConnected())
	}
}

func TestNoConnect(t *testing.T) {
	cli := &lifeClient{id: types.NewJID("1", types.DefaultUserServer)}
	m := NewManager(Options{Factory: func(context.Context) (Client, PresenceTransport, error) { return cli, nil, nil }, Emit: &evRec{}, NoConnect: true})
	m.Start(context.Background())
	time.Sleep(20 * time.Millisecond)
	if cli.connects != 0 {
		t.Fatal("connected with NoConnect set")
	}
	if err := m.StartQR(context.Background()); !errors.Is(err, ErrNoConnect) {
		t.Fatalf("StartQR: %v", err)
	}
	if m.Status().State != domain.AuthLoggedIn || m.Conn() != domain.ConnOffline {
		t.Errorf("state %s / %s", m.Status().State, m.Conn())
	}
}

func TestRemoteLogoutSwapsClient(t *testing.T) {
	first := &lifeClient{id: types.NewJID("1", types.DefaultUserServer)}
	second := &lifeClient{}
	made := 0
	loggedOut := make(chan struct{})
	m := NewManager(Options{
		Factory: func(context.Context) (Client, PresenceTransport, error) {
			made++
			if made == 1 {
				return first, nil, nil
			}
			return second, nil, nil
		},
		Emit:  &evRec{},
		Hooks: Hooks{LoggedOut: func() { close(loggedOut) }},
	})
	m.Start(context.Background())
	waitFor(t, func() bool { return first.connects == 1 })
	first.handler(&events.Connected{})
	if m.Conn() != domain.ConnConnected {
		t.Fatalf("conn %s", m.Conn())
	}
	first.handler(&events.LoggedOut{})
	select {
	case <-loggedOut:
	case <-time.After(2 * time.Second):
		t.Fatal("LoggedOut hook not called")
	}
	if m.Client() != second || m.Status().State != domain.AuthLoggedOut {
		t.Errorf("client not swapped or state wrong: %s", m.Status().State)
	}
}
