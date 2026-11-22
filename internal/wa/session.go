package wa

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"

	"github.com/whatszori/WhatsZori/internal/store"
)

// Session is whatsmeow's own sqlstore in session.db: keys, device identity, LID mappings and
// app state. Our migrations never touch it.
type Session struct {
	db        *sql.DB
	container *sqlstore.Container
	log       *slog.Logger
}

func OpenSession(ctx context.Context, path, version string, log *slog.Logger) (*Session, error) {
	db, err := sql.Open(store.Driver, store.DSN(path))
	if err != nil {
		return nil, err
	}
	c := sqlstore.NewWithDB(db, "sqlite", NewLogger(log).Sub("store"))
	if err := c.Upgrade(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("upgrade session.db: %w", err)
	}

	// shows up as "WhatsZori" under Linked devices on the phone
	var v [3]uint32
	fmt.Sscanf(version, "%d.%d.%d", &v[0], &v[1], &v[2])
	waStore.SetOSInfo("WhatsZori", v)
	waStore.DeviceProps.PlatformType = waCompanionReg.DeviceProps_DESKTOP.Enum()

	return &Session{db: db, container: c, log: log}, nil
}

func (s *Session) Close() error { return s.db.Close() }

// Factory returns the stored device's client, or a fresh device's when nobody is logged in.
func (s *Session) Factory() Factory {
	return func(ctx context.Context) (Client, PresenceTransport, error) {
		dev, err := s.container.GetFirstDevice(ctx)
		if err != nil {
			return nil, nil, err
		}
		cli := whatsmeow.NewClient(dev, NewLogger(s.log))
		// we write to SQLite inside the event handler; with this, whatsmeow only acks once the
		// handler returned, so a crash mid-write means the server sends the message again
		cli.SynchronousAck = true
		cli.EnableAutoReconnect = true
		cli.InitialAutoReconnect = true
		m := &Meow{Cli: cli}
		return m, m, nil
	}
}
