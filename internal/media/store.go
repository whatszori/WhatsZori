// Package media downloads attachments into <config>/media and serves them at /wz-media/<pk>.
package media

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/settings"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

type Downloader interface {
	DownloadMedia(ctx context.Context, m wa.MediaRef) ([]byte, error)
}

var (
	ErrExpired    = errors.New("media is no longer on WhatsApp's servers")
	ErrNoDownload = errors.New("not connected, can't download right now")
)

type Store struct {
	dir string
	db  *sql.DB
	// dl returns nil while we're offline or logged out
	dl  func() Downloader
	log *slog.Logger

	queue    chan int64
	mu       sync.Mutex
	inflight map[int64]*flight
}

type flight struct {
	done chan struct{}
	err  error
}

func New(dir string, db *sql.DB, dl func() Downloader, log *slog.Logger) *Store {
	if log == nil {
		log = slog.Default()
	}
	return &Store{dir: dir, db: db, dl: dl, log: log, queue: make(chan int64, 512), inflight: map[int64]*flight{}}
}

// Start runs the auto-download workers until ctx ends.
func (s *Store) Start(ctx context.Context, workers int) {
	for range max(workers, 1) {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case pk := <-s.queue:
					dctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
					if _, err := s.Ensure(dctx, pk); err != nil && !errors.Is(err, ErrExpired) {
						s.log.Info("auto-download failed", "pk", pk, "error", err)
					}
					cancel()
				}
			}
		}()
	}
}

// Enqueue asks for a background download. When the queue is full the item is dropped; it still
// downloads when someone opens it.
func (s *Store) Enqueue(pk int64) {
	select {
	case s.queue <- pk:
	default:
	}
}

// Remove deletes a stored file (when a deleted message is purged).
func (s *Store) Remove(rel string) {
	rel, err := assets.SafeRel(rel)
	if err != nil {
		return
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		return
	}
	defer root.Close()
	_ = root.Remove(filepath.FromSlash(rel))
}

func mediaType(t string) whatsmeow.MediaType {
	switch t {
	case "image":
		return whatsmeow.MediaImage
	case "video":
		return whatsmeow.MediaVideo
	case "audio":
		return whatsmeow.MediaAudio
	}
	return whatsmeow.MediaDocument
}

// Ensure makes sure pk's file is on disk, downloading it if needed. Concurrent calls for the same
// pk share one download.
func (s *Store) Ensure(ctx context.Context, pk int64) (repo.MediaRow, error) {
	row, err := repo.GetMedia(ctx, s.db, pk)
	if err != nil {
		return row, err
	}
	if row.State == repo.MediaLocal && s.exists(row.LocalPath) {
		return row, nil
	}
	if row.State == repo.MediaExpired {
		return row, ErrExpired
	}

	s.mu.Lock()
	f, running := s.inflight[pk]
	if !running {
		f = &flight{done: make(chan struct{})}
		s.inflight[pk] = f
	}
	s.mu.Unlock()
	if !running {
		f.err = s.download(ctx, row)
		s.mu.Lock()
		delete(s.inflight, pk)
		s.mu.Unlock()
		close(f.done)
	} else {
		select {
		case <-f.done:
		case <-ctx.Done():
			return row, ctx.Err()
		}
	}
	if f.err != nil {
		return row, f.err
	}
	return repo.GetMedia(ctx, s.db, pk)
}

func (s *Store) download(ctx context.Context, row repo.MediaRow) error {
	var dl Downloader
	if s.dl != nil {
		dl = s.dl()
	}
	if dl == nil {
		return ErrNoDownload
	}
	data, err := dl.DownloadMedia(ctx, wa.MediaRef{
		DirectPath: row.DirectPath, MediaKey: row.MediaKey, FileSHA256: row.FileSHA256,
		FileEncSHA256: row.FileEncSHA256, MediaType: mediaType(row.MediaType),
	})
	if err != nil {
		if errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404) || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410) ||
			errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith403) {
			_ = repo.SetMediaState(context.WithoutCancel(ctx), s.db, row.MessagePK, repo.MediaExpired)
			return ErrExpired
		}
		return fmt.Errorf("download: %w", err)
	}
	rel, err := s.Save(data, row.FileSHA256, row.Mime, row.FileName)
	if err != nil {
		return err
	}
	return repo.SetMediaLocal(context.WithoutCancel(ctx), s.db, row.MessagePK, rel)
}

// Save writes data under a content-hashed name and returns the path relative to the media
// folder. Same content, same file, so a forwarded photo is stored once.
func (s *Store) Save(data, sum []byte, mimeType, fileName string) (string, error) {
	if len(sum) != sha256.Size {
		h := sha256.Sum256(data)
		sum = h[:]
	}
	name := hex.EncodeToString(sum)
	rel := name[:2] + "/" + name + extFor(mimeType, fileName)
	full := filepath.Join(s.dir, filepath.FromSlash(rel))
	if st, err := os.Stat(full); err == nil && st.Size() == int64(len(data)) {
		return rel, nil
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", err
	}
	if err := settings.WriteFileAtomic(full, data); err != nil {
		return "", err
	}
	return rel, nil
}

func (s *Store) exists(rel string) bool {
	if _, err := assets.SafeRel(rel); err != nil {
		return false
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		return false
	}
	defer root.Close()
	st, err := root.Stat(filepath.FromSlash(rel))
	return err == nil && st.Mode().IsRegular()
}

var extByMime = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"video/mp4":       ".mp4",
	"video/3gpp":      ".3gp",
	"audio/ogg":       ".ogg",
	"audio/mpeg":      ".mp3",
	"audio/mp4":       ".m4a",
	"audio/aac":       ".aac",
	"application/pdf": ".pdf",
}

func extFor(mimeType, fileName string) string {
	mt, _, _ := mime.ParseMediaType(mimeType)
	if e, ok := extByMime[mt]; ok {
		return e
	}
	// documents keep their own extension, if it's a sane one
	e := strings.ToLower(path.Ext(fileName))
	if len(e) >= 2 && len(e) <= 8 && strings.Trim(e[1:], "abcdefghijklmnopqrstuvwxyz0123456789") == "" {
		return e
	}
	return ".bin"
}
