package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Plugins finds plugins in <config>/plugins/<id>/manifest.json and keeps their switches, settings
// and storage. The code itself runs in the webview (served from /wz-plugins/); this side never
// executes anything from those folders.
type Plugins struct {
	dir  string
	db   *sql.DB
	safe func() bool
}

func NewPlugins(dir string, db *sql.DB, safe func() bool) *Plugins {
	return &Plugins{dir: dir, db: db, safe: safe}
}

const (
	maxManifest     = 64 << 10
	maxSettingValue = 64 << 10
	maxStoredValue  = 1 << 20
	maxKey          = 256
)

var errBadKey = errors.New("keys are 1 to 256 characters")

type manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Author      string `json:"author"`
	Main        string `json:"main"`
}

// List returns every plugin folder, broken ones too (with Error set) so the user sees why.
func (p *Plugins) List() ([]domain.PluginInfo, error) {
	ctx, cancel := call()
	defer cancel()
	enabled, err := repo.PluginsEnabled(ctx, p.db)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(p.dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	out := []domain.PluginInfo{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		info := readPlugin(p.dir, e.Name())
		info.Enabled = enabled[info.ID] && info.Error == ""
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func readPlugin(dir, folder string) domain.PluginInfo {
	info := domain.PluginInfo{ID: folder, Name: folder}
	if !assets.ValidPluginID(folder) {
		info.Error = "the folder name can only have letters, digits, dots, dashes and underscores"
		return info
	}
	f, err := os.Open(filepath.Join(dir, folder, "manifest.json"))
	if err != nil {
		info.Error = "no manifest.json"
		return info
	}
	defer f.Close()
	var m manifest
	dec := json.NewDecoder(&limitedReader{f, maxManifest})
	if err := dec.Decode(&m); err != nil {
		info.Error = "manifest.json isn't valid JSON: " + err.Error()
		return info
	}
	if m.Main == "" {
		m.Main = "index.js"
	}
	info.Name, info.Version, info.Description, info.Author, info.Main = firstNonEmpty(m.Name, folder), m.Version, m.Description, m.Author, m.Main
	switch {
	case m.ID != folder:
		info.Error = fmt.Sprintf("the manifest id %q must match the folder name", m.ID)
	case !validMain(m.Main):
		info.Error = "main must be a .js or .mjs file inside the plugin folder"
	default:
		if st, err := os.Stat(filepath.Join(dir, folder, filepath.FromSlash(m.Main))); err != nil || st.IsDir() {
			info.Error = m.Main + " is missing"
		}
	}
	return info
}

func validMain(main string) bool {
	if _, err := assets.SafeRel(main); err != nil {
		return false
	}
	ext := strings.ToLower(path.Ext(main))
	return ext == ".js" || ext == ".mjs"
}

// SetEnabled turns a plugin on or off. The frontend starts or stops it right away.
func (p *Plugins) SetEnabled(id string, on bool) error {
	ctx, cancel := call()
	defer cancel()
	if !assets.ValidPluginID(id) {
		return errors.New("bad plugin id")
	}
	info := readPlugin(p.dir, id)
	if on && info.Error != "" {
		return errors.New(info.Error)
	}
	return repo.SetPluginEnabled(ctx, p.db, id, info.Version, on)
}

// IsSafeMode is here too so the loader needs one service.
func (p *Plugins) IsSafeMode() bool { return p.safe != nil && p.safe() }

func (p *Plugins) check(id, key string) error {
	if !assets.ValidPluginID(id) {
		return errors.New("bad plugin id")
	}
	if key == "" || len(key) > maxKey {
		return errBadKey
	}
	return nil
}

// Settings are small strings (JSON, usually) that the plugin shows in its settings block.
func (p *Plugins) Settings(id string) (map[string]string, error) {
	if err := p.check(id, "x"); err != nil {
		return nil, err
	}
	ctx, cancel := call()
	defer cancel()
	return repo.PluginSettings(ctx, p.db, id)
}

func (p *Plugins) SetSetting(id, key, value string) error {
	if err := p.check(id, key); err != nil {
		return err
	}
	if len(value) > maxSettingValue {
		return fmt.Errorf("a setting can be at most %d KB", maxSettingValue>>10)
	}
	ctx, cancel := call()
	defer cancel()
	return repo.SetPluginSetting(ctx, p.db, id, key, value)
}

func (p *Plugins) DeleteSetting(id, key string) error {
	if err := p.check(id, key); err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	return repo.DeletePluginSetting(ctx, p.db, id, key)
}

// StorageGet returns nil when the key isn't there.
func (p *Plugins) StorageGet(id, key string) (*string, error) {
	if err := p.check(id, key); err != nil {
		return nil, err
	}
	ctx, cancel := call()
	defer cancel()
	v, ok, err := repo.PluginGet(ctx, p.db, id, key)
	if err != nil || !ok {
		return nil, err
	}
	s := string(v)
	return &s, nil
}

func (p *Plugins) StorageSet(id, key, value string) error {
	if err := p.check(id, key); err != nil {
		return err
	}
	if len(value) > maxStoredValue {
		return fmt.Errorf("a stored value can be at most %d MB", maxStoredValue>>20)
	}
	ctx, cancel := call()
	defer cancel()
	return repo.PluginSet(ctx, p.db, id, key, []byte(value))
}

func (p *Plugins) StorageDelete(id, key string) error {
	if err := p.check(id, key); err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	return repo.PluginDelete(ctx, p.db, id, key)
}

func (p *Plugins) StorageKeys(id string) ([]string, error) {
	if err := p.check(id, "x"); err != nil {
		return nil, err
	}
	ctx, cancel := call()
	defer cancel()
	return repo.PluginKeys(ctx, p.db, id)
}

type limitedReader struct {
	f interface{ Read([]byte) (int, error) }
	n int64
}

func (l *limitedReader) Read(b []byte) (int, error) {
	if l.n <= 0 {
		return 0, errors.New("manifest.json is too big")
	}
	if int64(len(b)) > l.n {
		b = b[:l.n]
	}
	n, err := l.f.Read(b)
	l.n -= int64(n)
	return n, err
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}
