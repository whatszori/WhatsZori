// Package store opens whatszori.db (our data) and runs its migrations. whatsmeow's own session.db
// is opened separately in internal/wa and never touched here.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

const Driver = "sqlite"

// DSN builds a modernc.org/sqlite URI with the pragmas applied to every pooled connection.
func DSN(path string) string {
	q := url.Values{}
	for _, p := range []string{"journal_mode(WAL)", "foreign_keys(1)", "busy_timeout(5000)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	q.Set("_txlock", "immediate")
	return "file:" + filepath.ToSlash(path) + "?" + q.Encode()
}

func Open(ctx context.Context, path string) (*sql.DB, error) {
	db, err := sql.Open(Driver, DSN(path))
	if err != nil {
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	if err := Migrate(ctx, db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		num, _, ok := strings.Cut(e.Name(), "_")
		v, err := strconv.Atoi(num)
		if !ok || err != nil || v <= 0 {
			return nil, fmt.Errorf("bad migration name %q", e.Name())
		}
		body, err := migrations.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, migration{v, e.Name(), string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	for i, m := range out {
		if m.version != i+1 {
			return nil, fmt.Errorf("migrations must be numbered 1..n without gaps, got %s", m.name)
		}
	}
	return out, nil
}

func Version(ctx context.Context, db *sql.DB) (int, error) {
	var v int
	err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&v)
	return v, err
}

// Migrate applies every migration newer than PRAGMA user_version, each in its own transaction
// together with the version bump, so a failed one leaves the db at the previous version.
func Migrate(ctx context.Context, db *sql.DB) error {
	all, err := loadMigrations()
	if err != nil {
		return err
	}
	cur, err := Version(ctx, db)
	if err != nil {
		return err
	}
	if cur > len(all) {
		return fmt.Errorf("whatszori.db is version %d, this build only knows %d; it was opened by a newer WhatsZori", cur, len(all))
	}
	for _, m := range all[cur:] {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, m.sql); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", m.name, err)
		}
		// PRAGMA can't take a bound parameter; the version is our own int
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %s: %w", m.name, err)
		}
	}
	return nil
}

// InTx runs fn in a transaction and commits if it returns nil.
func InTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Wipe deletes everything we stored, but keeps the schema. whatsmeow's session.db isn't touched.
func Wipe(ctx context.Context, db *sql.DB) error {
	return InTx(ctx, db, func(tx *sql.Tx) error {
		for _, t := range []string{"group_events", "chat_list_members", "chat_lists", "avatars", "reactions", "receipts", "message_edits", "media", "messages", "group_participants", "contacts", "chats"} {
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+t); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')")
		return err
	})
}
