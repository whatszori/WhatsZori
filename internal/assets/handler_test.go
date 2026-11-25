package assets

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type fixture struct {
	themes, plugins, outside string
	h                        http.Handler
}

func setup(t *testing.T) fixture {
	t.Helper()
	base := t.TempDir()
	f := fixture{
		themes:  filepath.Join(base, "config", "themes"),
		plugins: filepath.Join(base, "config", "plugins"),
		outside: filepath.Join(base, "secret.txt"),
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(f.themes, "img"), 0o755))
	must(os.MkdirAll(filepath.Join(f.plugins, "demo"), 0o755))
	must(os.WriteFile(filepath.Join(f.themes, "dusk.css"), []byte(":root{}"), 0o644))
	must(os.WriteFile(filepath.Join(f.themes, "img", "bg.png"), []byte("png"), 0o644))
	must(os.WriteFile(filepath.Join(f.plugins, "demo", "index.js"), []byte("export {}"), 0o644))
	must(os.WriteFile(f.outside, []byte("top secret"), 0o644))

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, `<!doctype html><html lang="en"><head></head><body>embedded</body></html>`)
	})
	f.h = Middleware(Options{
		ThemesDir:  f.themes,
		PluginsDir: f.plugins,
		HTMLAttrs:  func() map[string]string { return map[string]string{"data-theme": "dark"} },
		CSP:        PageCSP,
	})(next)
	return f
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "http://wails.localhost/", nil)
	// set the decoded path directly so encoded tricks reach the handler as they would in the webview
	req.URL.Path = target
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestServesThemesAndPlugins(t *testing.T) {
	f := setup(t)

	rec := get(f.h, "/wz-themes/dusk.css")
	if rec.Code != 200 || rec.Body.String() != ":root{}" {
		t.Fatalf("theme: %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Errorf("theme content type %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("theme cache-control %q", cc)
	}

	if rec := get(f.h, "/wz-themes/img/bg.png"); rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Errorf("theme asset: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}

	rec = get(f.h, "/wz-plugins/demo/index.js")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("plugin: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestRejectsTraversal(t *testing.T) {
	f := setup(t)
	bad := []string{
		"/wz-themes/../secret.txt",
		"/wz-themes/../../secret.txt",
		"/wz-themes/img/../../secret.txt",
		"/wz-themes/..\\secret.txt",
		"/wz-themes/img\\..\\..\\secret.txt",
		"/wz-themes//etc/passwd",
		"/wz-themes/C:/Windows/win.ini",
		"/wz-themes/C:\\Windows\\win.ini",
		"/wz-themes/dusk.css:stream",
		"/wz-themes/dusk.css.",
		"/wz-themes/NUL",
		"/wz-themes/con.css",
		"/wz-themes/./dusk.css",
		"/wz-themes/dusk.css\x00.png",
		"/wz-themes/",
		"/wz-themes/img",
		"/wz-plugins/../themes/dusk.css",
		"/wz-plugins/../../secret.txt",
		"/wz-plugins/demo/../../../secret.txt",
		"/wz-plugins/../secret.txt",
		"/wz-plugins/demo",
		"/wz-plugins/",
		"/wz-media/123",
	}
	for _, p := range bad {
		rec := get(f.h, p)
		if rec.Code == 200 {
			t.Errorf("%q: served %q", p, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "top secret") {
			t.Errorf("%q leaked the outside file", p)
		}
	}
}

func TestRejectsSymlinkOutOfFolder(t *testing.T) {
	f := setup(t)
	link := filepath.Join(f.themes, "evil.css")
	if err := os.Symlink(f.outside, link); err != nil {
		t.Skipf("can't create symlinks here: %v", err)
	}
	rec := get(f.h, "/wz-themes/evil.css")
	if rec.Code == 200 || strings.Contains(rec.Body.String(), "top secret") {
		t.Fatalf("symlink escaped the themes folder: %d %q", rec.Code, rec.Body.String())
	}
}

func TestIndexGetsHTMLAttrs(t *testing.T) {
	f := setup(t)
	rec := get(f.h, "/")
	if !strings.Contains(rec.Body.String(), `<html data-theme="dark" lang="en">`) {
		t.Fatalf("attrs not injected: %s", rec.Body.String())
	}
	if rec.Header().Get("Content-Length") != strconv.Itoa(rec.Body.Len()) {
		t.Errorf("content-length %s for %d bytes", rec.Header().Get("Content-Length"), rec.Body.Len())
	}
	if rec := get(f.h, "/assets/app.js"); strings.Contains(rec.Body.String(), "data-theme") {
		t.Error("only the index page should be rewritten")
	}
}

func TestSafeRel(t *testing.T) {
	ok := []string{"a.css", "dir/a.css", "my-theme.v2.css"}
	for _, p := range ok {
		if _, err := SafeRel(p); err != nil {
			t.Errorf("%q should be fine", p)
		}
	}
}

func TestIndexGetsCSP(t *testing.T) {
	f := setup(t)
	csp := get(f.h, "/").Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "connect-src 'self';") {
		t.Fatalf("the page must not reach the internet on its own: %q", csp)
	}
	if get(f.h, "/assets/app.js").Header().Get("Content-Security-Policy") != "" {
		t.Error("only the page gets the policy")
	}
}
