// Package core wires the WhatsApp side together: both databases, the whatsmeow client, ingest,
// the privacy gate, anti-spam, media and the batching emitter. Services sit on top of it.
package core

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	waStore "go.mau.fi/whatsmeow/store"

	"github.com/whatszori/WhatsZori/internal/antispam"
	"github.com/whatszori/WhatsZori/internal/config"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/ingest"
	"github.com/whatszori/WhatsZori/internal/media"
	"github.com/whatszori/WhatsZori/internal/privacy"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/settings"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

// Settings keys Go reads. "app" is the frontend's AppSettings (we only look at "history"),
// "privacy" is ghost mode and belongs to Go.
const (
	KeyApp     = "app"
	KeyPrivacy = "privacy"
)

type Core struct {
	Paths    config.Paths
	DB       *sql.DB
	Session  *wa.Session
	Mgr      *wa.Manager
	In       *ingest.Ingester
	Gate     *privacy.Gate
	Media    *media.Store
	Sender   *wa.Sender
	JIDs     *wa.JIDs
	Emit     *events.Batcher
	settings *settings.Store
	log      *slog.Logger
	cancel   context.CancelFunc
}

type Options struct {
	Paths     config.Paths
	Settings  *settings.Store
	Version   string
	NoConnect bool
	Out       events.Emitter
	Log       *slog.Logger
}

func New(ctx context.Context, o Options) (*Core, error) {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	db, err := store.Open(ctx, o.Paths.DataDB())
	if err != nil {
		return nil, err
	}
	sess, err := wa.OpenSession(ctx, o.Paths.SessionDB(), o.Version, o.Log)
	if err != nil {
		db.Close()
		return nil, err
	}
	c := &Core{Paths: o.Paths, DB: db, Session: sess, settings: o.Settings, log: o.Log}
	c.Emit = events.NewBatcher(o.Out, 50*time.Millisecond, 200)

	var ghost domain.GhostSettings
	if !o.Settings.Decode(KeyPrivacy, &ghost) {
		ghost = domain.DefaultGhost()
	}
	c.Gate = privacy.New(ingest.Reads{DB: db}, ghost)

	var mgr *wa.Manager
	client := func() wa.Client {
		if mgr == nil {
			return nil
		}
		return mgr.Client()
	}
	c.JIDs = wa.NewJIDs(func() waStore.LIDStore {
		if cli := client(); cli != nil {
			return cli.LIDs()
		}
		return nil
	})
	c.Media = media.New(o.Paths.Media, db, func() media.Downloader {
		cli, err := c.Mgr.Ready()
		if err != nil {
			return nil
		}
		return cli
	}, o.Log)
	c.In = ingest.New(ingest.Options{DB: db, JIDs: c.JIDs, Emit: c.Emit, Policy: c.Policy, Client: client, Media: c.Media, Log: o.Log})

	mgr = wa.NewManager(wa.Options{
		Factory:   sess.Factory(),
		Emit:      c.Emit,
		NoConnect: o.NoConnect,
		Log:       o.Log,
		Hooks: wa.Hooks{
			Event:       c.In.Handle,
			Connected:   c.onConnected,
			ClientReady: func(_ wa.Client, pt wa.PresenceTransport) { c.Gate.SetTransport(pt) },
		},
	})
	c.Mgr = mgr
	c.Sender = &wa.Sender{
		DB:      db,
		Ready:   mgr.Ready,
		Gate:    c.Gate,
		Limiter: antispam.New(antispam.DefaultLimits()),
		Local:   c.In,
		Media:   c.Media,
		Emit:    c.Emit,
		Log:     o.Log,
	}
	return c, nil
}

func (c *Core) Start(ctx context.Context) error {
	ctx, c.cancel = context.WithCancel(ctx)
	c.Media.Start(ctx, 2)
	return c.Mgr.Start(ctx)
}

func (c *Core) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	c.Mgr.Stop()
	c.Emit.Close()
	c.Session.Close()
	c.DB.Close()
}

// Policy is what the user chose under Settings → History.
func (c *Core) Policy() domain.HistoryPolicy {
	var s struct {
		History domain.History `json:"history"`
	}
	c.settings.Decode(KeyApp, &s)
	return s.History.Policy()
}

func (c *Core) SetGhost(ctx context.Context, g domain.GhostSettings) error {
	if err := c.Gate.SetGhost(ctx, g); err != nil {
		c.log.Warn("apply ghost mode", "error", redact.Digits(err.Error()))
	}
	return c.settings.Set(KeyPrivacy, c.Gate.Ghost())
}

func (c *Core) View(ctx context.Context) repo.View { return repo.View{Me: c.In.Me(ctx)} }

func (c *Core) onConnected(cli wa.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := c.Gate.Online(ctx); err != nil {
		c.log.Warn("send presence", "error", redact.Digits(err.Error()))
	}
	if groups, err := cli.GetJoinedGroups(ctx); err == nil {
		if err := c.In.SyncGroups(ctx, groups); err != nil {
			c.log.Error("store groups", "error", err)
		}
	} else {
		c.log.Warn("joined groups", "error", redact.Digits(err.Error()))
	}
	if contacts, err := cli.AllContacts(ctx); err == nil {
		if err := c.In.SyncContacts(ctx, contacts); err != nil {
			c.log.Error("store contacts", "error", err)
		}
	}
}

// Wipe deletes our messages, chats and downloaded media. The WhatsApp session isn't touched; log
// out first to remove that too.
func (c *Core) Wipe(ctx context.Context) error {
	if err := store.Wipe(ctx, c.DB); err != nil {
		return err
	}
	entries, err := os.ReadDir(c.Paths.Media)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(c.Paths.Media, e.Name())); err != nil {
			return fmt.Errorf("clear media: %w", err)
		}
	}
	return nil
}
