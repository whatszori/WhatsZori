package market

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/whatszori/WhatsZori/internal/plugins"
)

type fixture struct {
	srv      *httptest.Server
	files    map[string][]byte
	index    []byte
	sig      string
	indexKey ed25519.PrivateKey
}

// a marketplace with one signed plugin and one theme, served like raw.githubusercontent.com
func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{files: map[string][]byte{}}
	_, f.indexKey, _ = ed25519.GenerateKey(nil)
	_, pubKey, _ := ed25519.GenerateKey(nil)

	// build and sign the plugin the way an author would
	src := t.TempDir()
	os.WriteFile(filepath.Join(src, "manifest.json"), []byte(`{"id":"hello","name":"Hello","version":"1.2.0","apiVersion":2}`), 0o644)
	os.WriteFile(filepath.Join(src, "index.js"), []byte(`export default { start() {} }`), 0o644)
	if err := plugins.Sign(src, pubKey); err != nil {
		t.Fatal(err)
	}
	fp := plugins.Fingerprint(pubKey.Public().(ed25519.PublicKey))

	item := func(kind, id, dir string, names map[string][]byte) Item {
		it := Item{Kind: kind, ID: id, Name: id, Version: "1.2.0", Dir: dir, Key: fp}
		for name, data := range names {
			sum := sha256.Sum256(data)
			it.Files = append(it.Files, File{Path: name, Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:])})
			f.files["/"+dir+"/"+name] = data
		}
		return it
	}
	pl := map[string][]byte{}
	for _, n := range []string{"manifest.json", "index.js", "signature.json"} {
		pl[n], _ = os.ReadFile(filepath.Join(src, n))
	}
	theme := item("theme", "dusk", "themes/dusk/files", map[string][]byte{
		"manifest.json": []byte(`{"id":"dusk","name":"Dusk","version":"1.0.0","modules":[{"id":"m","name":"M","file":"parts/a.css"}]}`),
		"parts/a.css":   []byte(":root{}"),
	})
	theme.Key = ""

	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			w.Write(f.index)
		case "/index.json.sig":
			w.Write([]byte(f.sig))
		default:
			if data, ok := f.files[r.URL.Path]; ok {
				w.Write(data)
				return
			}
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	ix := Index{Version: 1, Base: f.srv.URL, Items: []Item{item("plugin", "hello", "plugins/hello/files", pl), theme}}
	f.index, _ = json.Marshal(ix)
	f.resign()
	return f
}

func (f *fixture) resign() {
	f.sig = base64.StdEncoding.EncodeToString(ed25519.Sign(f.indexKey, f.index))
}

func (f *fixture) store(t *testing.T) *Store {
	s := New(t.TempDir(), t.TempDir(), "0.2.0")
	s.IndexURL = f.srv.URL + "/index.json"
	s.Key = f.indexKey.Public().(ed25519.PublicKey)
	return s
}

func TestInstallAndUpdate(t *testing.T) {
	f := newFixture(t)
	// the test server is http; Index insists on an https base, so swap it for this test
	f.index = []byte(strings.Replace(string(f.index), `"base":"http://`, `"base":"https://`, 1))
	f.resign()
	s := f.store(t)
	s.Client = f.srv.Client()
	s.Client.Transport = rewrite{to: f.srv.URL}

	ctx := context.Background()
	if err := s.Install(ctx, "plugin", "hello"); err != nil {
		t.Fatal(err)
	}
	if v := s.Installed("plugin", "hello"); v != "1.2.0" {
		t.Fatalf("installed %q", v)
	}
	if sig := plugins.Verify(filepath.Join(s.PluginsDir, "hello")); sig.State != "signed" {
		t.Fatalf("signature after install: %+v", sig)
	}
	// installing again replaces it cleanly, without leftovers
	if err := s.Install(ctx, "plugin", "hello"); err != nil {
		t.Fatal(err)
	}
	if left, _ := os.ReadDir(s.PluginsDir); len(left) != 1 {
		t.Fatalf("leftovers: %v", left)
	}
	if err := s.Install(ctx, "theme", "dusk"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.ThemesDir, "dusk", "parts", "a.css")); err != nil {
		t.Fatal(err)
	}
	if err := s.Uninstall("theme", "dusk"); err != nil || s.Installed("theme", "dusk") != "" {
		t.Fatalf("uninstall: %v", err)
	}
}

func TestRefusesTampering(t *testing.T) {
	f := newFixture(t)
	f.index = []byte(strings.Replace(string(f.index), `"base":"http://`, `"base":"https://`, 1))
	f.resign()
	ctx := context.Background()
	newStore := func() *Store {
		s := f.store(t)
		s.Client = f.srv.Client()
		s.Client.Transport = rewrite{to: f.srv.URL}
		return s
	}

	// a file changed on the server after the index was signed
	f.files["/plugins/hello/files/index.js"] = []byte(`export default { start() { steal() } }`)
	if err := newStore().Install(ctx, "plugin", "hello"); err == nil || !(strings.Contains(err.Error(), "doesn't match") || strings.Contains(err.Error(), "bigger than expected")) {
		t.Fatalf("tampered file: %v", err)
	}

	// an index not signed by the marketplace key
	f.sig = base64.StdEncoding.EncodeToString(make([]byte, 64))
	if _, err := newStore().Index(ctx, true); err == nil || !strings.Contains(err.Error(), "isn't signed") {
		t.Fatalf("unsigned index: %v", err)
	}
	f.resign()

	// the index names another signing key than the plugin has
	f.index = []byte(strings.Replace(string(f.index), `"key":"`, `"key":"0000 `, 1))
	f.resign()
	f.files["/plugins/hello/files/index.js"] = []byte(`export default { start() {} }`)
	if err := newStore().Install(ctx, "plugin", "hello"); err == nil || !strings.Contains(err.Error(), "another key") {
		t.Fatalf("key mismatch: %v", err)
	}
}

func TestNewer(t *testing.T) {
	if !Newer("1.10.0", "1.9.3") || Newer("1.0.0", "1.0.0") || Newer("0.9.0", "1.0.0") {
		t.Fatal("version compare")
	}
}

// sends every request to the test server whatever its scheme and host
type rewrite struct{ to string }

func (r rewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.URL.Scheme = "http"
	req.URL.Host = strings.TrimPrefix(r.to, "http://")
	return http.DefaultTransport.RoundTrip(req)
}
