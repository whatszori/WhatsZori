package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/plugins"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/uploads"
)

// Plugins finds plugins in <config>/plugins/<id>/manifest.json and keeps their switches, what
// the user allowed them, their settings and storage. The code runs in the webview (served from
// /wz-plugins/); this side never executes anything from those folders. The parts of the plugin
// API that leave the page (network, desktop notifications, saving files) come through here and
// are checked against what the user allowed.
type Plugins struct {
	dir     string
	db      *sql.DB
	safe    func() bool
	opts    PluginOptions
	fetcher *plugins.Fetcher

	mu         sync.Mutex
	lastNotify map[string]time.Time
}

type PluginOptions struct {
	AppVersion string
	Emit       events.Emitter
	Uploads    *uploads.Store
	// native save dialog; "" when cancelled
	PickSavePath func(title, name string) (string, error)
	// a desktop notification
	Notify func(title, body string) error
}

func NewPlugins(dir string, db *sql.DB, safe func() bool, opts PluginOptions) *Plugins {
	return &Plugins{
		dir: dir, db: db, safe: safe, opts: opts,
		fetcher:    plugins.NewFetcher("WhatsZori/" + opts.AppVersion),
		lastNotify: map[string]time.Time{},
	}
}

const (
	maxSettingValue = 64 << 10
	maxStoredValue  = 1 << 20
	maxKey          = 256
	notifyGap       = 3 * time.Second
	pluginDebounce  = 300 * time.Millisecond
)

var (
	errBadKey      = errors.New("keys are 1 to 256 characters")
	errNotAllowed  = errors.New("the plugin isn't allowed to do that")
	errNotRunning  = errors.New("the plugin isn't turned on")
	errNeedsReview = errors.New("the plugin asks for new permissions; allow them in Settings → Plugins first")
)

type grant struct {
	Permissions []string `json:"permissions"`
	Network     []string `json:"network"`
	Key         string   `json:"key,omitempty"`
}

// List returns every plugin folder, broken ones too (with Error set) so the user sees why.
func (p *Plugins) List() ([]domain.PluginInfo, error) {
	ctx, cancel := call()
	defer cancel()
	enabled, err := repo.PluginsEnabled(ctx, p.db)
	if err != nil {
		return nil, err
	}
	grants, err := repo.PluginGrants(ctx, p.db)
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
		info, _ := p.read(e.Name(), enabled[e.Name()], grants[e.Name()])
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// read builds what the app shows about one plugin folder.
func (p *Plugins) read(folder string, enabled bool, granted string) (domain.PluginInfo, plugins.Manifest) {
	info := domain.PluginInfo{ID: folder, Name: folder, Permissions: []string{}, Network: []string{},
		Settings: []domain.PluginSetting{}, NewPermissions: []string{}, NewNetwork: []string{},
		Signature: domain.PluginSignature{State: "unsigned"}}
	if !assets.ValidPluginID(folder) {
		info.Error = "the folder name can only have letters, digits, dots, dashes and underscores"
		return info, plugins.Manifest{}
	}
	m, err := plugins.Read(p.dir, folder)
	if err != nil {
		info.Error = err.Error()
		return info, m
	}
	info.Name = firstNonEmpty(m.Name, folder)
	info.Version, info.Description, info.Author, info.Homepage = m.Version, m.Description, m.Author, m.Homepage
	info.Main, info.Icon, info.APIVersion, info.Sandbox = m.Main, m.Icon, m.APIVersion, m.Sandbox
	info.Permissions = slices.Clone(m.Requested())
	if m.Network != nil {
		info.Network = m.Network
	}
	for _, s := range m.Settings {
		ds := domain.PluginSetting{Key: s.Key, Type: s.Type, Label: s.Label, Description: s.Description,
			Placeholder: s.Placeholder, Default: s.Default, Min: s.Min, Max: s.Max}
		for _, o := range s.Options {
			ds.Options = append(ds.Options, domain.PluginOption{Value: o.Value, Label: o.Label})
		}
		info.Settings = append(info.Settings, ds)
	}
	sig := plugins.Verify(filepath.Join(p.dir, folder))
	info.Signature = domain.PluginSignature{State: sig.State, Key: sig.Key, Publisher: sig.Publisher, Reason: sig.Reason}

	if problems := m.Problems(folder, p.opts.AppVersion); len(problems) > 0 {
		info.Error = strings.Join(problems, "; ")
	} else if st, err := os.Stat(filepath.Join(p.dir, folder, filepath.FromSlash(m.Main))); err != nil || st.IsDir() {
		info.Error = m.Main + " is missing"
	} else if sig.State == "invalid" {
		info.Error = "the signature doesn't check out: " + sig.Reason
	}

	// v1 plugins had their access without asking, so there's nothing to approve for them
	if m.APIVersion >= 2 {
		var g grant
		_ = json.Unmarshal([]byte(granted), &g)
		for _, perm := range info.Permissions {
			if !slices.Contains(g.Permissions, perm) {
				info.NewPermissions = append(info.NewPermissions, perm)
			}
		}
		for _, d := range info.Network {
			if !slices.Contains(g.Network, d) {
				info.NewNetwork = append(info.NewNetwork, d)
			}
		}
		info.KeyChanged = g.Key != "" && g.Key != sig.Key
		info.NeedsApproval = granted == "" || len(info.NewPermissions) > 0 || len(info.NewNetwork) > 0 || info.KeyChanged
	}
	info.Enabled = enabled && info.Error == ""
	return info, m
}

func (p *Plugins) one(id string) (domain.PluginInfo, plugins.Manifest, error) {
	if !assets.ValidPluginID(id) {
		return domain.PluginInfo{}, plugins.Manifest{}, errors.New("bad plugin id")
	}
	ctx, cancel := call()
	defer cancel()
	enabled, err := repo.PluginsEnabled(ctx, p.db)
	if err != nil {
		return domain.PluginInfo{}, plugins.Manifest{}, err
	}
	grants, err := repo.PluginGrants(ctx, p.db)
	if err != nil {
		return domain.PluginInfo{}, plugins.Manifest{}, err
	}
	info, m := p.read(id, enabled[id], grants[id])
	return info, m, nil
}

// PermissionInfo describes each permission, for the approval dialog.
func (p *Plugins) PermissionInfo() map[string]string { return plugins.Permissions }

// Approve stores what the plugin asks for right now (permissions, sites, signing key) as allowed.
func (p *Plugins) Approve(id string) error {
	info, _, err := p.one(id)
	if err != nil {
		return err
	}
	if info.Error != "" {
		return errors.New(info.Error)
	}
	data, _ := json.Marshal(grant{Permissions: info.Permissions, Network: info.Network, Key: info.Signature.Key})
	ctx, cancel := call()
	defer cancel()
	return repo.SetPluginGrant(ctx, p.db, id, info.Version, string(data))
}

// Revoke turns a plugin off and forgets what the user allowed it; turning it on asks again.
func (p *Plugins) Revoke(id string) error {
	if !assets.ValidPluginID(id) {
		return errors.New("bad plugin id")
	}
	ctx, cancel := call()
	defer cancel()
	if err := repo.SetPluginEnabled(ctx, p.db, id, "", false); err != nil {
		return err
	}
	return repo.SetPluginGrant(ctx, p.db, id, "", "")
}

// SetEnabled turns a plugin on or off. The frontend starts or stops it right away.
func (p *Plugins) SetEnabled(id string, on bool) error {
	info, _, err := p.one(id)
	if err != nil {
		return err
	}
	if on && info.Error != "" {
		return errors.New(info.Error)
	}
	if on && info.NeedsApproval {
		return errNeedsReview
	}
	ctx, cancel := call()
	defer cancel()
	return repo.SetPluginEnabled(ctx, p.db, id, info.Version, on)
}

// allowed: the plugin is on, approved, and has perm
func (p *Plugins) allowed(id, perm string) (domain.PluginInfo, error) {
	info, _, err := p.one(id)
	if err != nil {
		return info, err
	}
	switch {
	case !info.Enabled || p.IsSafeMode():
		return info, errNotRunning
	case info.NeedsApproval:
		return info, errNeedsReview
	case !slices.Contains(info.Permissions, perm):
		return info, fmt.Errorf("%w: it needs the %q permission in its manifest", errNotAllowed, perm)
	}
	return info, nil
}

// Fetch makes a request for a plugin, only to the sites its manifest lists and the user allowed.
func (p *Plugins) Fetch(id string, req domain.PluginFetchRequest) (domain.PluginFetchResponse, error) {
	info, err := p.allowed(id, "network")
	if err != nil {
		return domain.PluginFetchResponse{}, err
	}
	res, err := p.fetcher.Do(context.Background(), id, info.Network, plugins.FetchRequest{
		URL: req.URL, Method: req.Method, Headers: req.Headers, Body: req.Body, TimeoutMs: req.TimeoutMs,
	})
	if err != nil {
		return domain.PluginFetchResponse{}, err
	}
	return domain.PluginFetchResponse{Status: res.Status, StatusText: res.StatusText, Headers: res.Headers,
		Body: res.Body, URL: res.URL}, nil
}

// Notify shows a desktop notification for a plugin, at most one every few seconds.
func (p *Plugins) Notify(id, title, body string) error {
	info, err := p.allowed(id, "notifications")
	if err != nil {
		return err
	}
	if p.opts.Notify == nil {
		return errors.New("notifications aren't available")
	}
	p.mu.Lock()
	if time.Since(p.lastNotify[id]) < notifyGap {
		p.mu.Unlock()
		return errors.New("too many notifications, wait a few seconds")
	}
	p.lastNotify[id] = time.Now()
	p.mu.Unlock()
	title = clipRunes(strings.TrimSpace(title), 80)
	if title == "" {
		title = info.Name
	}
	return p.opts.Notify(title, clipRunes(strings.TrimSpace(body), 300))
}

// SaveFile asks where to save a file the plugin made (uploaded to /wz-upload/ first) and writes
// it there. Returns the path, or "" when the user cancelled.
func (p *Plugins) SaveFile(id, token, name string) (string, error) {
	if _, err := p.allowed(id, "files"); err != nil {
		return "", err
	}
	if p.opts.Uploads == nil || p.opts.PickSavePath == nil {
		return "", errors.New("saving files isn't available")
	}
	_, data, err := p.opts.Uploads.Read(token)
	if err != nil {
		return "", err
	}
	defer p.opts.Uploads.Drop(token)
	dest, err := p.opts.PickSavePath("Save file", filepath.Base(name))
	if err != nil || dest == "" {
		return "", err
	}
	return dest, os.WriteFile(dest, data, 0o644)
}

// ServiceStartup watches the plugins folder so the frontend can restart a plugin whose files
// changed (wz-plugin dev).
func (p *Plugins) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if p.opts.Emit == nil {
		return nil
	}
	_ = os.MkdirAll(p.dir, 0o755)
	err := plugins.Watch(ctx, p.dir, pluginDebounce, func(id string) {
		p.opts.Emit.Emit(events.PluginChanged, domain.PluginChangedEvent{ID: id})
	})
	if err != nil {
		slog.Warn("plugin watcher not running", "error", err)
	}
	return nil
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

func clipRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}
