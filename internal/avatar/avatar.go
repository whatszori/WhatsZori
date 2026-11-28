// Package avatar fetches profile pictures and group photos, keeps them in <config>/avatars and
// serves them at /wz-avatar/<jid>.
package avatar

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/settings"
)

type Fetcher interface {
	GetProfilePicture(ctx context.Context, jid types.JID, existingID string, preview bool) (*types.ProfilePictureInfo, error)
}

const (
	Preview = "preview"
	Full    = "full"

	stateSet    = "set"
	stateNone   = "none"
	stateHidden = "hidden"

	// how long an answer from WhatsApp counts as current; a Picture event resets it early
	maxAge   = 24 * time.Hour
	maxBytes = 5 << 20
)

var ErrNoPicture = errors.New("no profile picture")

type Store struct {
	dir string
	db  *sql.DB
	// fetcher returns nil while we're offline
	fetcher func() Fetcher
	http    *http.Client
	log     *slog.Logger
	now     func() time.Time

	// a chat list full of avatars must not turn into a burst of requests to WhatsApp
	slots    chan struct{}
	mu       sync.Mutex
	inflight map[string]*flight
}

type flight struct {
	done chan struct{}
	rel  string
	err  error
}

func New(dir string, db *sql.DB, fetcher func() Fetcher, log *slog.Logger) *Store {
	if log == nil {
		log = slog.Default()
	}
	return &Store{
		dir: dir, db: db, fetcher: fetcher, log: log, now: time.Now,
		http:     &http.Client{Timeout: 30 * time.Second},
		slots:    make(chan struct{}, 3),
		inflight: map[string]*flight{},
	}
}

type row struct {
	pictureID string
	localPath string
	state     string
	checkedAt int64
}

func (s *Store) get(ctx context.Context, jid, variant string) (row, bool, error) {
	var r row
	err := s.db.QueryRowContext(ctx, `SELECT picture_id, local_path, state, checked_at FROM avatars WHERE jid = ? AND variant = ?`, jid, variant).
		Scan(&r.pictureID, &r.localPath, &r.state, &r.checkedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return r, false, nil
	}
	return r, err == nil, err
}

func (s *Store) put(ctx context.Context, jid, variant string, r row) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO avatars (jid, variant, picture_id, local_path, state, checked_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (jid, variant) DO UPDATE SET picture_id = excluded.picture_id, local_path = excluded.local_path,
			state = excluded.state, checked_at = excluded.checked_at`,
		jid, variant, r.pictureID, r.localPath, r.state, r.checkedAt)
	return err
}

// Invalidate makes the next request ask WhatsApp again (the picture changed).
func (s *Store) Invalidate(ctx context.Context, jid string) {
	if _, err := s.db.ExecContext(ctx, `UPDATE avatars SET checked_at = 0 WHERE jid = ?`, jid); err != nil {
		s.log.Warn("invalidate avatar", "error", err)
	}
}

// Ensure returns the avatar file (relative to the avatars folder), fetching it when what we have
// is older than a day. Offline, a stale picture is still better than none.
func (s *Store) Ensure(ctx context.Context, jid types.JID, variant string) (string, error) {
	key := jid.String()
	r, found, err := s.get(ctx, key, variant)
	if err != nil {
		return "", err
	}
	fresh := found && s.now().Sub(time.UnixMilli(r.checkedAt)) < maxAge
	if fresh || s.fetcher == nil || s.fetcher() == nil {
		return s.result(r)
	}

	fk := key + "/" + variant
	s.mu.Lock()
	f, running := s.inflight[fk]
	if !running {
		f = &flight{done: make(chan struct{})}
		s.inflight[fk] = f
	}
	s.mu.Unlock()
	if running {
		select {
		case <-f.done:
			return f.rel, f.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	f.rel, f.err = s.refresh(ctx, jid, variant, r)
	s.mu.Lock()
	delete(s.inflight, fk)
	s.mu.Unlock()
	close(f.done)
	return f.rel, f.err
}

func (s *Store) result(r row) (string, error) {
	if r.state == stateSet && r.localPath != "" && s.exists(r.localPath) {
		return r.localPath, nil
	}
	return "", ErrNoPicture
}

func (s *Store) refresh(ctx context.Context, jid types.JID, variant string, old row) (string, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return "", ctx.Err()
	}
	f := s.fetcher()
	if f == nil {
		return s.result(old)
	}
	existing := ""
	if old.state == stateSet && s.exists(old.localPath) {
		existing = old.pictureID
	}
	now := s.now().UnixMilli()
	info, err := f.GetProfilePicture(ctx, jid, existing, variant == Preview)
	switch {
	case errors.Is(err, whatsmeow.ErrProfilePictureNotSet):
		return "", s.clear(ctx, jid.String(), variant, stateNone, now)
	case errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized):
		return "", s.clear(ctx, jid.String(), variant, stateHidden, now)
	case err != nil:
		s.log.Info("profile picture", "jid", redact.JID(jid.String()), "error", redact.Digits(err.Error()))
		return s.result(old)
	case info == nil:
		// unchanged since last time
		old.checkedAt = now
		if err := s.put(ctx, jid.String(), variant, old); err != nil {
			return "", err
		}
		return s.result(old)
	}
	rel, err := s.download(ctx, info.URL)
	if err != nil {
		s.log.Info("download profile picture", "jid", redact.JID(jid.String()), "error", err)
		return s.result(old)
	}
	if err := s.put(ctx, jid.String(), variant, row{pictureID: info.ID, localPath: rel, state: stateSet, checkedAt: now}); err != nil {
		return "", err
	}
	if old.localPath != "" && old.localPath != rel {
		s.remove(old.localPath)
	}
	return rel, nil
}

func (s *Store) clear(ctx context.Context, jid, variant, state string, now int64) error {
	if r, found, _ := s.get(ctx, jid, variant); found && r.localPath != "" {
		s.remove(r.localPath)
	}
	if err := s.put(ctx, jid, variant, row{state: state, checkedAt: now}); err != nil {
		return err
	}
	return ErrNoPicture
}

// only WhatsApp's own CDN; the URL comes from the server, but there's no reason to fetch anything else
func allowedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "whatsapp.net" || strings.HasSuffix(h, ".whatsapp.net")
}

func (s *Store) download(ctx context.Context, raw string) (string, error) {
	if !allowedURL(raw) {
		return "", fmt.Errorf("unexpected picture host")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return "", err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxBytes || !strings.HasPrefix(http.DetectContentType(data), "image/") {
		return "", fmt.Errorf("not a picture")
	}
	return s.save(data)
}

func (s *Store) save(data []byte) (string, error) {
	sum := sha256.Sum256(data)
	rel := hex.EncodeToString(sum[:]) + ".jpg"
	full := filepath.Join(s.dir, rel)
	if _, err := os.Stat(full); err == nil {
		return rel, nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", err
	}
	return rel, settings.WriteFileAtomic(full, data)
}

func (s *Store) exists(rel string) bool {
	if _, err := assets.SafeRel(rel); err != nil {
		return false
	}
	st, err := os.Stat(filepath.Join(s.dir, filepath.FromSlash(rel)))
	return err == nil && st.Mode().IsRegular()
}

func (s *Store) remove(rel string) {
	// two contacts can share a picture (same hash); only drop it when nobody points at it anymore
	var n int
	if s.db.QueryRow(`SELECT COUNT(*) FROM avatars WHERE local_path = ?`, rel).Scan(&n) == nil && n > 1 {
		return
	}
	if _, err := assets.SafeRel(rel); err == nil {
		_ = os.Remove(filepath.Join(s.dir, rel))
	}
}

// Cached is the absolute path of jid's small picture if it's already on disk, without asking
// WhatsApp. For notifications, which must not wait for the network.
func (s *Store) Cached(jid string) string {
	r, found, err := s.get(context.Background(), jid, Preview)
	if err != nil || !found || r.state != stateSet || !s.exists(r.localPath) {
		return ""
	}
	return filepath.Join(s.dir, filepath.FromSlash(r.localPath))
}

// FullPath returns the full-size picture's file, fetching it when needed.
func (s *Store) FullPath(ctx context.Context, jid types.JID) (string, error) {
	rel, err := s.Ensure(ctx, jid.ToNonAD(), Full)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.dir, filepath.FromSlash(rel)), nil
}

// Handler serves /wz-avatar/<jid> (preview size) and /wz-avatar/<jid>?full=1. 404 means "show
// initials": no picture, hidden, or offline with nothing cached.
func (s *Store) Handler(prefix string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		raw, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, prefix))
		if err != nil || raw == "" || strings.ContainsAny(raw, "/\\") {
			http.NotFound(w, r)
			return
		}
		jid, err := types.ParseJID(raw)
		if err != nil || jid.User == "" {
			http.NotFound(w, r)
			return
		}
		variant := Preview
		if r.URL.Query().Get("full") == "1" {
			variant = Full
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		rel, err := s.Ensure(ctx, jid.ToNonAD(), variant)
		if err != nil {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(s.dir, rel))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Type", "image/jpeg")
		h.Set("X-Content-Type-Options", "nosniff")
		// the frontend adds ?v=<n> when a Picture event says it changed, so an hour is safe
		h.Set("Cache-Control", "private, max-age=3600")
		http.ServeContent(w, r, "", st.ModTime(), f)
	})
}
