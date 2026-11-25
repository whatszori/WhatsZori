// Package market installs plugins and themes from the marketplace: a GitHub repository
// (whatszori/marketplace) whose CI checks every submission and publishes a signed index.json.
// The app trusts the index only if its signature matches the key built in here; every file it
// downloads must match the size and SHA-256 the index lists; a plugin must also be signed, with the
// key the index names. Nothing is downloaded until the user opens the Marketplace.
package market

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/whatszori/WhatsZori/internal/plugins"
)

// DefaultIndex is where the index lives; index.json.sig sits next to it.
const DefaultIndex = "https://raw.githubusercontent.com/whatszori/marketplace/main/index.json"

// IndexKey checks index.json.sig. Its private half is a secret of the marketplace repository's CI.
var IndexKey = mustKey("rImouf7rzkI6t17J+vGedVA44PSts9SaqaGrUxGLW8g=")

const (
	maxIndex     = 5 << 20
	maxFile      = 10 << 20
	maxTotal     = 50 << 20
	maxFiles     = 500
	cacheFor     = 10 * time.Minute
	fetchTimeout = 30 * time.Second
)

var idRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type File struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Item is one plugin or theme in the index.
type Item struct {
	// plugin | theme
	Kind          string   `json:"kind"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Description   string   `json:"description"`
	Author        string   `json:"author"`
	Homepage      string   `json:"homepage,omitempty"`
	Repo          string   `json:"repo,omitempty"`
	Tags          []string `json:"tags"`
	MinAppVersion string   `json:"minAppVersion,omitempty"`
	// URLs, already absolute
	Icon        string   `json:"icon,omitempty"`
	Screenshots []string `json:"screenshots"`
	// plugins
	APIVersion  int      `json:"apiVersion,omitempty"`
	Sandbox     bool     `json:"sandbox,omitempty"`
	Permissions []string `json:"permissions"`
	Network     []string `json:"network"`
	// fingerprint of the key the plugin is signed with
	Key string `json:"key,omitempty"`
	// where its files are, relative to the index's base
	Dir     string `json:"dir"`
	Files   []File `json:"files"`
	Updated string `json:"updated,omitempty"`
}

type Index struct {
	Version   int    `json:"version"`
	Generated string `json:"generated"`
	// the folder URL every Dir is relative to
	Base  string `json:"base"`
	Items []Item `json:"items"`
}

type Store struct {
	IndexURL   string
	Key        ed25519.PublicKey
	PluginsDir string
	ThemesDir  string
	AppVersion string
	Client     *http.Client

	mu      sync.Mutex
	cached  *Index
	fetched time.Time
}

func New(pluginsDir, themesDir, appVersion string) *Store {
	u := DefaultIndex
	if v := os.Getenv("WHATSZORI_MARKET_URL"); v != "" {
		u = v
	}
	return &Store{
		IndexURL: u, Key: IndexKey, PluginsDir: pluginsDir, ThemesDir: themesDir, AppVersion: appVersion,
		Client: &http.Client{Timeout: fetchTimeout},
	}
}

// Index returns the marketplace, fetching it when the cached copy is old (or refresh is set).
func (s *Store) Index(ctx context.Context, refresh bool) (*Index, error) {
	s.mu.Lock()
	if !refresh && s.cached != nil && time.Since(s.fetched) < cacheFor {
		ix := s.cached
		s.mu.Unlock()
		return ix, nil
	}
	s.mu.Unlock()

	raw, err := s.get(ctx, s.IndexURL, maxIndex)
	if err != nil {
		return nil, fmt.Errorf("couldn't load the marketplace: %w", err)
	}
	sigText, err := s.get(ctx, s.IndexURL+".sig", 4096)
	if err != nil {
		return nil, fmt.Errorf("couldn't load the marketplace's signature: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigText)))
	if err != nil || !ed25519.Verify(s.Key, raw, sig) {
		return nil, errors.New("the marketplace list isn't signed by WhatsZori; not using it")
	}
	var ix Index
	if err := json.Unmarshal(raw, &ix); err != nil {
		return nil, fmt.Errorf("the marketplace list is broken: %w", err)
	}
	if ix.Version != 1 {
		return nil, errors.New("this marketplace needs a newer WhatsZori")
	}
	if _, err := url.Parse(ix.Base); err != nil || !strings.HasPrefix(ix.Base, "https://") {
		return nil, errors.New("the marketplace list has a bad base address")
	}
	if ix.Items == nil {
		ix.Items = []Item{}
	}
	s.mu.Lock()
	s.cached, s.fetched = &ix, time.Now()
	s.mu.Unlock()
	return &ix, nil
}

func (s *Store) get(ctx context.Context, u string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WhatsZori/"+s.AppVersion)
	res, err := s.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered %d", req.URL.Host, res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("the download is bigger than expected")
	}
	return data, nil
}

func (s *Store) find(ctx context.Context, kind, id string) (Item, string, error) {
	ix, err := s.Index(ctx, false)
	if err != nil {
		return Item{}, "", err
	}
	for _, it := range ix.Items {
		if it.Kind == kind && it.ID == id {
			return it, ix.Base, nil
		}
	}
	return Item{}, "", fmt.Errorf("%s isn't in the marketplace", id)
}

func (s *Store) target(kind, id string) (string, error) {
	if !idRe.MatchString(id) || strings.Contains(id, "..") {
		return "", errors.New("bad id")
	}
	switch kind {
	case "plugin":
		return filepath.Join(s.PluginsDir, id), nil
	case "theme":
		return filepath.Join(s.ThemesDir, id), nil
	}
	return "", errors.New("unknown kind")
}

// Install downloads an item, checks every file and, for a plugin, its signature, and then puts it
// in place of whatever version was there.
func (s *Store) Install(ctx context.Context, kind, id string) error {
	it, base, err := s.find(ctx, kind, id)
	if err != nil {
		return err
	}
	if it.MinAppVersion != "" && s.AppVersion != "" && compare(s.AppVersion, it.MinAppVersion) < 0 {
		return fmt.Errorf("%s needs WhatsZori %s or newer", it.Name, it.MinAppVersion)
	}
	dest, err := s.target(kind, id)
	if err != nil {
		return err
	}
	if len(it.Files) == 0 || len(it.Files) > maxFiles {
		return errors.New("the marketplace entry has no files")
	}
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	// staging and backup sit next to the target so the final moves are renames on one disk;
	// the dot keeps the plugin and theme lists from showing them
	stage := filepath.Join(parent, "."+id+".installing-"+randHex())
	defer os.RemoveAll(stage)

	var total int64
	for _, f := range it.Files {
		if !plugins.SafeRel(f.Path) || f.Size < 0 || f.Size > maxFile {
			return fmt.Errorf("the marketplace entry lists a bad file: %s", f.Path)
		}
		if total += f.Size; total > maxTotal {
			return errors.New("it's too big to install")
		}
		data, err := s.get(ctx, joinURL(base, it.Dir, f.Path), f.Size)
		if err != nil {
			return fmt.Errorf("downloading %s: %w", f.Path, err)
		}
		sum := sha256.Sum256(data)
		if int64(len(data)) != f.Size || !strings.EqualFold(hex.EncodeToString(sum[:]), f.SHA256) {
			return fmt.Errorf("%s doesn't match what the marketplace lists; not installing", f.Path)
		}
		p := filepath.Join(stage, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			return err
		}
	}

	if kind == "plugin" {
		sig := plugins.Verify(stage)
		switch {
		case sig.State != "signed":
			return errors.New("the downloaded plugin isn't properly signed; not installing")
		case it.Key != "" && sig.Key != it.Key:
			return errors.New("the downloaded plugin is signed with another key than the marketplace lists")
		}
		m, err := plugins.Read(filepath.Dir(stage), filepath.Base(stage))
		if err != nil {
			return err
		}
		if m.ID != id {
			return errors.New("the downloaded plugin has another id than its marketplace entry")
		}
	}

	backup := ""
	if _, err := os.Stat(dest); err == nil {
		backup = filepath.Join(parent, "."+id+".previous-"+randHex())
		if err := os.Rename(dest, backup); err != nil {
			return fmt.Errorf("couldn't replace the installed version (is a file in it open?): %w", err)
		}
	}
	if err := os.Rename(stage, dest); err != nil {
		if backup != "" {
			_ = os.Rename(backup, dest)
		}
		return err
	}
	if backup != "" {
		_ = os.RemoveAll(backup)
	}
	return nil
}

// Uninstall removes an installed plugin or theme folder.
func (s *Store) Uninstall(kind, id string) error {
	dest, err := s.target(kind, id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(dest); err != nil {
		return nil
	}
	return os.RemoveAll(dest)
}

// Installed returns the version of what's installed under id, "" when nothing is.
func (s *Store) Installed(kind, id string) string {
	dest, err := s.target(kind, id)
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(dest, "manifest.json"))
	if err != nil {
		return ""
	}
	var m struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(data, &m) != nil || m.Version == "" {
		return "?"
	}
	return m.Version
}

// Newer reports whether a is a later version than b.
func Newer(a, b string) bool { return compare(a, b) > 0 }

func joinURL(base string, parts ...string) string {
	escaped := make([]string, 0, len(parts))
	for _, p := range parts {
		for _, seg := range strings.Split(p, "/") {
			if seg != "" {
				escaped = append(escaped, url.PathEscape(seg))
			}
		}
	}
	return strings.TrimSuffix(base, "/") + "/" + path.Join(escaped...)
}

func compare(a, b string) int {
	n := func(v string) [3]int {
		var out [3]int
		v, _, _ = strings.Cut(v, "-")
		v, _, _ = strings.Cut(v, "+")
		for i, s := range strings.SplitN(v, ".", 3) {
			out[i], _ = strconv.Atoi(s)
		}
		return out
	}
	x, y := n(a), n(b)
	for i := range 3 {
		if x[i] != y[i] {
			if x[i] < y[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func randHex() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func mustKey(b64 string) ed25519.PublicKey {
	k, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(k) != ed25519.PublicKeySize {
		panic("bad marketplace key")
	}
	return ed25519.PublicKey(bytes.Clone(k))
}
