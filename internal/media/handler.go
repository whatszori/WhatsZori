package media

import (
	"bytes"
	"context"
	"errors"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Handler serves /wz-media/<pk>. A file that isn't local yet is downloaded on the spot; while that
// fails (offline, expired) the thumbnail stands in. ?thumb=1 asks for the thumbnail directly.
func (s *Store) Handler(prefix string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		pk, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, prefix), 10, 64)
		if err != nil || pk <= 0 {
			http.NotFound(w, r)
			return
		}
		row, err := repo.GetMedia(r.Context(), s.db, pk)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		safeHeaders(w)
		if r.URL.Query().Get("thumb") == "1" && len(row.Thumbnail) > 0 {
			serveThumb(w, r, row, true)
			return
		}
		if row.State != repo.MediaLocal || !s.exists(row.LocalPath) {
			ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
			row, err = s.Ensure(ctx, pk)
			cancel()
			if err != nil {
				if len(row.Thumbnail) > 0 {
					// no-store, so the full file is fetched once it can be
					serveThumb(w, r, row, false)
					return
				}
				if errors.Is(err, ErrExpired) {
					http.Error(w, "gone", http.StatusGone)
					return
				}
				http.NotFound(w, r)
				return
			}
		}
		s.serveLocal(w, r, row)
	})
}

func safeHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	// it's other people's content on our origin: never let it run anything
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
}

func serveThumb(w http.ResponseWriter, r *http.Request, row repo.MediaRow, cache bool) {
	ct := http.DetectContentType(row.Thumbnail)
	if !strings.HasPrefix(ct, "image/") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ct)
	if cache {
		w.Header().Set("Cache-Control", "private, max-age=86400")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	http.ServeContent(w, r, "thumb", time.Time{}, bytes.NewReader(row.Thumbnail))
}

// types the webview may render inline; anything else is served as a download
var inlineTypes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true,
	"video/mp4": true, "video/3gpp": true, "video/webm": true,
	"audio/ogg": true, "audio/mpeg": true, "audio/mp4": true, "audio/aac": true, "audio/wav": true,
	"application/pdf": true,
}

func (s *Store) serveLocal(w http.ResponseWriter, r *http.Request, row repo.MediaRow) {
	rel, err := assets.SafeRel(row.LocalPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}

	mt, params, _ := mime.ParseMediaType(row.Mime)
	h := w.Header()
	if inlineTypes[mt] {
		// keep codecs=opus and friends, the audio element wants them
		h.Set("Content-Type", mime.FormatMediaType(mt, params))
	} else {
		h.Set("Content-Type", "application/octet-stream")
		name := row.FileName
		if name == "" {
			name = "file" + filepath.Ext(rel)
		}
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	// the name is a content hash, so the bytes behind a URL never change
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", st.ModTime(), f)
}
