package settings

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Set("app", map[string]any{"theme": "dark"}); err != nil {
		t.Fatal(err)
	}

	again, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Theme string }
	if !again.Decode("app", &got) || got.Theme != "dark" {
		t.Fatalf("got %+v", got)
	}
}

func TestStoreReadsFileWithBOM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	content := append([]byte{0xef, 0xbb, 0xbf}, []byte(`{"app":{"theme":"light"}}`)...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Theme string }
	if !s.Decode("app", &got) || got.Theme != "light" {
		t.Fatalf("BOM file not read: %+v", got)
	}
}

func TestStoreKeepsBrokenFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.All()) != 0 {
		t.Fatal("expected empty store")
	}
	matches, _ := filepath.Glob(filepath.Join(dir, "settings.json.broken-*"))
	if len(matches) != 1 {
		t.Fatalf("broken file not kept: %v", matches)
	}
}
