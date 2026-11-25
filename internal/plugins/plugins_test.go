package plugins

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProblems(t *testing.T) {
	ok := Manifest{ID: "x", Name: "X", Version: "1.0.0", Main: "index.js", APIVersion: 2,
		Permissions: []string{"network", "messages"}, Network: []string{"api.example.com", "*.openai.com", "localhost:11434"},
		Settings: []Setting{{Key: "token", Type: "password", Label: "Token"}}}
	if p := ok.Problems("x", "0.1.0"); len(p) != 0 {
		t.Fatalf("good manifest: %v", p)
	}
	cases := map[string]func(m *Manifest){
		"must match the folder":      func(m *Manifest) { m.ID = "y" },
		"unknown permission":         func(m *Manifest) { m.Permissions = append(m.Permissions, "everything") },
		`needs "network" too`:        func(m *Manifest) { m.Permissions = []string{"messages"} },
		"too broad":                  func(m *Manifest) { m.Network = []string{"*.com"} },
		"not an IP address":          func(m *Manifest) { m.Network = []string{"8.8.8.8"} },
		"without https://":           func(m *Manifest) { m.Network = []string{"https://api.example.com/v1"} },
		"WhatsZori 9.0.0 or newer":   func(m *Manifest) { m.MinAppVersion = "9.0.0" },
		"update WhatsZori":           func(m *Manifest) { m.APIVersion = 3 },
		"a select needs options":     func(m *Manifest) { m.Settings = []Setting{{Key: "k", Type: "select", Label: "K"}} },
		"main must be":               func(m *Manifest) { m.Main = "../x.js" },
		`need "apiVersion": 2`:       func(m *Manifest) { m.APIVersion = 1 },
		"needs the sites":            func(m *Manifest) { m.Network = nil },
		"type must be":               func(m *Manifest) { m.Settings = []Setting{{Key: "k", Type: "color", Label: "K"}} },
		"homepage must start":        func(m *Manifest) { m.Homepage = "http://x.org" },
		"icon must be":               func(m *Manifest) { m.Icon = "icon.exe" },
		"is listed twice":            func(m *Manifest) { m.Permissions = append(m.Permissions, "messages") },
		"key must be":                func(m *Manifest) { m.Settings = []Setting{{Key: "a b", Type: "text", Label: "K"}} },
		"version should look like":   func(m *Manifest) { m.Version = "one" },
		"minAppVersion should look":  func(m *Manifest) { m.MinAppVersion = "soon" },
		"letters, digits, dots, das": func(m *Manifest) { m.ID = "a..b" },
	}
	for want, change := range cases {
		m := ok
		m.Permissions = append([]string(nil), ok.Permissions...)
		change(&m)
		got := strings.Join(m.Problems(m.ID, "0.1.0"), "; ")
		if m.ID == "y" {
			got = strings.Join(m.Problems("x", "0.1.0"), "; ")
		}
		if !strings.Contains(got, want) {
			t.Errorf("%q: got %q", want, got)
		}
	}
	if got := (Manifest{APIVersion: 1}).Requested(); len(got) != 2 {
		t.Errorf("v1 plugins keep what the first API gave them: %v", got)
	}
}

func TestAllowed(t *testing.T) {
	pats := []string{"api.example.com", "*.cdn.org", "localhost:11434"}
	for raw, want := range map[string]bool{
		"https://api.example.com/v1":        true,
		"https://API.example.com":           true,
		"https://x.api.example.com":         false,
		"https://a.b.cdn.org/x":             true,
		"https://cdn.org/":                  false,
		"http://api.example.com":            false,
		"http://localhost:11434/api":        true,
		"http://localhost:8080":             false,
		"https://evil.com/?api.example.com": false,
		"https://api.example.com.evil.com":  false,
		"https://user@api.example.com":      false,
		"file:///etc/passwd":                false,
		"wss://api.example.com":             false,
	} {
		u, _ := url.Parse(raw)
		if got := Allowed(u, pats) == nil; got != want {
			t.Errorf("%s: allowed=%v, want %v", raw, got, want)
		}
	}
}

func TestPrivateAddresses(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.5", "169.254.1.1", "::1", "fd00::1", "100.64.0.1", "0.0.0.0"} {
		if !isPrivate(net.ParseIP(ip)) {
			t.Errorf("%s should count as local", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "1.1.1.1", "2606:4700::1111"} {
		if isPrivate(net.ParseIP(ip)) {
			t.Errorf("%s is public", ip)
		}
	}
}

func TestFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/echo":
			w.Header().Set("X-Seen-UA", r.UserAgent())
			w.Header().Set("X-Seen-Cookie", r.Header.Get("Cookie"))
			w.Header().Set("Set-Cookie", "a=b")
			w.WriteHeader(201)
			buf := make([]byte, 100)
			n, _ := r.Body.Read(buf)
			w.Write(append([]byte(r.Method+":"), buf[:n]...))
		case "/away":
			http.Redirect(w, r, "https://elsewhere.example/", http.StatusFound)
		}
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	pats := []string{"localhost:" + u.Port()}
	base := "http://localhost:" + u.Port()
	f := NewFetcher("WhatsZori/test")

	res, err := f.Do(context.Background(), "demo", pats, FetchRequest{URL: base + "/echo", Method: "post",
		Headers: map[string]string{"Cookie": "secret=1", "X-Ok": "1"}, Body: base64.StdEncoding.EncodeToString([]byte("hi"))})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := base64.StdEncoding.DecodeString(res.Body)
	if res.Status != 201 || string(body) != "POST:hi" {
		t.Fatalf("got %d %q", res.Status, body)
	}
	if res.Headers["x-seen-ua"] != "WhatsZori/test plugin/demo" || res.Headers["x-seen-cookie"] != "" {
		t.Errorf("headers: %v", res.Headers)
	}
	if _, ok := res.Headers["set-cookie"]; ok {
		t.Error("cookies must not reach the plugin")
	}
	if _, err := f.Do(context.Background(), "demo", pats, FetchRequest{URL: base + "/away"}); err == nil || !strings.Contains(err.Error(), "network list") {
		t.Errorf("a redirect off the list must fail: %v", err)
	}
	if _, err := f.Do(context.Background(), "demo", pats, FetchRequest{URL: "https://example.org/"}); err == nil {
		t.Error("a site that isn't listed was fetched")
	}
	if _, err := f.Do(context.Background(), "demo", pats, FetchRequest{URL: base + "/echo", Method: "CONNECT"}); err == nil {
		t.Error("CONNECT went through")
	}
}

func TestSignature(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"s"}`), 0o644)
	os.MkdirAll(filepath.Join(dir, "lib"), 0o755)
	os.WriteFile(filepath.Join(dir, "lib", "a.js"), []byte(`export const a = 1`), 0o644)
	if s := Verify(dir); s.State != "unsigned" {
		t.Fatalf("no signature.json: %+v", s)
	}
	_, priv, _ := ed25519.GenerateKey(nil)
	if err := Sign(dir, priv); err != nil {
		t.Fatal(err)
	}
	s := Verify(dir)
	if s.State != "signed" || s.Key != Fingerprint(priv.Public().(ed25519.PublicKey)) || len(s.Key) != 19 {
		t.Fatalf("signed: %+v", s)
	}
	os.WriteFile(filepath.Join(dir, "lib", "a.js"), []byte(`export const a = 2`), 0o644)
	if s := Verify(dir); s.State != "invalid" || !strings.Contains(s.Reason, "changed after") {
		t.Fatalf("tampered: %+v", s)
	}
	os.WriteFile(filepath.Join(dir, "lib", "a.js"), []byte(`export const a = 1`), 0o644)
	os.WriteFile(filepath.Join(dir, "extra.js"), []byte(`x`), 0o644)
	if s := Verify(dir); s.State != "invalid" {
		t.Fatalf("an added file must break it: %+v", s)
	}
	os.WriteFile(filepath.Join(dir, SignatureFile), []byte(`{"key":"nope"}`), 0o644)
	if s := Verify(dir); s.State != "invalid" {
		t.Fatalf("broken file: %+v", s)
	}
}

// the SDK signs in JavaScript; this is the digest it must produce for the same files
func TestDigestFormat(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "b.js"), []byte("b"), 0o644)
	os.WriteFile(filepath.Join(dir, "a.js"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(dir, SignatureFile), []byte("{}"), 0o644)
	d, err := Digest(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := digestHeader +
		"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.js\n" +
		"3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.js\n"
	if string(d) != want {
		t.Fatalf("digest:\n%s", d)
	}
}
