// Package uploads holds files the user is about to send: picked in the file dialog, pasted, or
// edited in the photo editor. The page only ever sees a token, previews the file through
// /wz-upload/<token> and sends it by token, so file bytes never travel through JSON bindings.
package uploads

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// MaxBytes is WhatsApp's limit for a document; photos are smaller, wa.Sender checks that.
const MaxBytes = 100 << 20

var (
	ErrTooBig   = errors.New("files can be at most 100 MB")
	ErrEmpty    = errors.New("the file is empty")
	ErrNotFound = errors.New("this attachment is gone, add it again")
)

// Item is what the page knows about a waiting attachment.
type Item struct {
	Token string `json:"token"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mime  string `json:"mime"`
	// image | video | file: what the preview shows
	Kind string `json:"kind"`
}

type entry struct {
	Item
	path string
	// owned files are ours (pasted, edited) and get deleted; picked ones are the user's
	owned bool
}

type Store struct {
	dir   string
	mu    sync.Mutex
	items map[string]*entry
}

// New empties dir: anything there is left over from a run that didn't get to clean up.
func New(dir string) (*Store, error) {
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir, items: map[string]*entry{}}, nil
}

// AddPath registers a file picked in the dialog. It isn't copied, it's read when sent.
func (s *Store) AddPath(path string) (Item, error) {
	st, err := os.Stat(path)
	if err != nil {
		return Item{}, err
	}
	if st.IsDir() {
		return Item{}, errors.New("folders can't be sent")
	}
	if st.Size() > MaxBytes {
		return Item{}, ErrTooBig
	}
	if st.Size() == 0 {
		return Item{}, ErrEmpty
	}
	f, err := os.Open(path)
	if err != nil {
		return Item{}, err
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	f.Close()
	return s.add(&entry{Item: Item{Name: filepath.Base(path), Size: st.Size(), Mime: sniff(head[:n], path)}, path: path}), nil
}

// AddReader saves r (a pasted file, an edited photo) to a temp file.
func (s *Store) AddReader(name string, r io.Reader) (Item, error) {
	name = cleanName(name)
	f, err := os.CreateTemp(s.dir, "up-*"+strings.ToLower(filepath.Ext(name)))
	if err != nil {
		return Item{}, err
	}
	n, err := io.Copy(f, io.LimitReader(r, MaxBytes+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	fail := func(e error) (Item, error) {
		os.Remove(f.Name())
		return Item{}, e
	}
	switch {
	case err != nil:
		return fail(err)
	case n > MaxBytes:
		return fail(ErrTooBig)
	case n == 0:
		return fail(ErrEmpty)
	}
	head, err := readHead(f.Name())
	if err != nil {
		return fail(err)
	}
	return s.add(&entry{Item: Item{Name: name, Size: n, Mime: sniff(head, name)}, path: f.Name(), owned: true}), nil
}

func (s *Store) add(e *entry) Item {
	e.Token = token()
	e.Kind = kindOf(e.Mime)
	s.mu.Lock()
	s.items[e.Token] = e
	s.mu.Unlock()
	return e.Item
}

// Read gives the file's bytes for sending.
func (s *Store) Read(tok string) (Item, []byte, error) {
	s.mu.Lock()
	e := s.items[tok]
	s.mu.Unlock()
	if e == nil {
		return Item{}, nil, ErrNotFound
	}
	st, err := os.Stat(e.path)
	if err != nil {
		return Item{}, nil, ErrNotFound
	}
	if st.Size() > MaxBytes {
		return Item{}, nil, ErrTooBig
	}
	data, err := os.ReadFile(e.path)
	if err != nil {
		return Item{}, nil, err
	}
	return e.Item, data, nil
}

// Drop forgets a token (sent, removed from the preview, or replaced by an edited copy).
func (s *Store) Drop(tok string) {
	s.mu.Lock()
	e := s.items[tok]
	delete(s.items, tok)
	s.mu.Unlock()
	if e != nil && e.owned {
		os.Remove(e.path)
	}
}

// Close deletes the temp files.
func (s *Store) Close() {
	s.mu.Lock()
	s.items = map[string]*entry{}
	s.mu.Unlock()
	_ = os.RemoveAll(s.dir)
}

func (s *Store) path(tok string) (*entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.items[tok]
	return e, ok
}

// Handler serves prefix (e.g. "/wz-upload/"):
//
//	POST prefix?name=photo.png  body = the file  -> Item as JSON
//	GET  prefix<token>                           -> the file, for the preview
func (s *Store) Handler(prefix string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.URL.Path, prefix)
		switch {
		case r.Method == http.MethodPost && tok == "":
			it, err := s.AddReader(r.URL.Query().Get("name"), r.Body)
			if err != nil {
				code := http.StatusInternalServerError
				if errors.Is(err, ErrTooBig) {
					code = http.StatusRequestEntityTooLarge
				} else if errors.Is(err, ErrEmpty) {
					code = http.StatusBadRequest
				}
				http.Error(w, err.Error(), code)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(it)
		case r.Method == http.MethodGet || r.Method == http.MethodHead:
			e, ok := s.path(tok)
			if !ok {
				http.NotFound(w, r)
				return
			}
			f, err := os.Open(e.path)
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
			w.Header().Set("Content-Type", e.Mime)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			// the name is shown by the page, not used here; ServeContent wants one for nothing else
			http.ServeContent(w, r, "", st.ModTime(), f)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}

func readHead(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	return head[:n], nil
}

// sniff trusts the bytes for media and the extension for the rest (a .docx sniffs as zip)
func sniff(head []byte, name string) string {
	m := http.DetectContentType(head)
	if strings.HasPrefix(m, "image/") || strings.HasPrefix(m, "video/") || strings.HasPrefix(m, "audio/") {
		return m
	}
	if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); byExt != "" {
		return byExt
	}
	return m
}

func kindOf(m string) string {
	m, _, _ = strings.Cut(m, ";")
	switch {
	case m == "image/jpeg", m == "image/png", m == "image/webp", m == "image/gif", m == "image/bmp":
		return "image"
	case strings.HasPrefix(m, "video/"):
		return "video"
	}
	return "file"
}

// cleanName keeps a plain file name: no folders, no control characters, not too long
func cleanName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(`<>:"/\|?*`, r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		name = "file"
	}
	if r := []rune(name); len(r) > 120 {
		// keep the extension, it decides the icon and the mime type on the other side
		ext := []rune(filepath.Ext(name))
		if len(ext) > 16 {
			ext = nil
		}
		name = string(r[:120-len(ext)]) + string(ext)
	}
	return name
}

func token() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
