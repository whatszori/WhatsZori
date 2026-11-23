package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/whatszori/WhatsZori/internal/store"
)

func TestPlugins(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("hello/manifest.json", `{"id":"hello","name":"Hello","version":"1.0.0","main":"index.js"}`)
	write("hello/index.js", `export default { start() {} }`)
	write("wrong-id/manifest.json", `{"id":"other","name":"X"}`)
	write("wrong-id/index.js", ``)
	write("no-main/manifest.json", `{"id":"no-main","main":"../evil.js"}`)
	write("broken/manifest.json", `{nope`)
	os.MkdirAll(filepath.Join(dir, "empty"), 0o755)

	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	p := NewPlugins(dir, db, func() bool { return false })

	list, err := p.List()
	if err != nil {
		t.Fatal(err)
	}
	errs := map[string]string{}
	for _, it := range list {
		errs[it.ID] = it.Error
		if it.Enabled {
			t.Errorf("%s is on before the user turned it on", it.ID)
		}
	}
	if len(list) != 5 || errs["hello"] != "" {
		t.Fatalf("list: %+v", list)
	}
	for _, id := range []string{"wrong-id", "no-main", "broken", "empty"} {
		if errs[id] == "" {
			t.Errorf("%s should be reported as broken", id)
		}
	}
	if err := p.SetEnabled("broken", true); err == nil {
		t.Error("a broken plugin was enabled")
	}
	if err := p.SetEnabled("hello", true); err != nil {
		t.Fatal(err)
	}
	list, _ = p.List()
	for _, it := range list {
		if it.ID == "hello" && !it.Enabled {
			t.Error("enable didn't stick")
		}
	}

	if err := p.SetSetting("hello", "lang", `"de"`); err != nil {
		t.Fatal(err)
	}
	if s, _ := p.Settings("hello"); s["lang"] != `"de"` {
		t.Errorf("settings: %v", s)
	}
	if v, _ := p.StorageGet("hello", "missing"); v != nil {
		t.Error("missing key should be nil")
	}
	p.StorageSet("hello", "a", "1")
	p.StorageSet("hello", "b", "2")
	p.StorageSet("other", "a", "x") // a different plugin's key
	if v, _ := p.StorageGet("hello", "a"); v == nil || *v != "1" {
		t.Errorf("get: %v", v)
	}
	p.StorageDelete("hello", "b")
	if keys, _ := p.StorageKeys("hello"); len(keys) != 1 || keys[0] != "a" {
		t.Errorf("keys: %v", keys)
	}
	if err := p.StorageSet("../x", "a", "1"); err == nil {
		t.Error("bad id accepted")
	}
	if err := p.SetSetting("hello", "", "1"); err == nil {
		t.Error("empty key accepted")
	}
}
