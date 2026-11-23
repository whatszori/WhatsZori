package themes

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseMeta(t *testing.T) {
	css := bom + "\n/**\n * @name Dusk\n * @id dusk\n * @author Someone Nice\n * @version 1.2.0\n * @description Warm and dark.\n * @unknown ignored\n */\n:root { --wz-accent: #c66; }\n"
	m := ParseMeta([]byte(css))
	want := Meta{ID: "dusk", Name: "Dusk", Author: "Someone Nice", Version: "1.2.0", Description: "Warm and dark."}
	if m != want {
		t.Fatalf("got %+v, want %+v", m, want)
	}
}

func TestParseMetaNeedsLeadingComment(t *testing.T) {
	css := ":root{}\n/* @name Late */"
	if m := ParseMeta([]byte(css)); m.Name != "" {
		t.Fatalf("metadata after rules should be ignored, got %+v", m)
	}
	if m := ParseMeta([]byte("/* @name Open")); m.Name != "" {
		t.Fatal("unterminated comment should be ignored")
	}
	if m := ParseMeta([]byte("/* @name One line */")); m.Name != "One line" {
		t.Fatalf("single-line header: %+v", m)
	}
}

func TestList(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("b.css", "/* @name Beta */")
	write("plain.css", ":root{}")
	write("notes.txt", "x")
	if err := os.Mkdir(filepath.Join(dir, "assets.css"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "Beta" || got[1].Name != "plain" || got[1].ID != "plain" {
		t.Fatalf("unexpected list: %+v", got)
	}
	if got[0].Hash == "" || got[0].File != "b.css" {
		t.Fatalf("missing file or hash: %+v", got[0])
	}
}

func TestWatchDebounces(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	changes := make(chan Changed, 10)
	if err := Watch(ctx, dir, 80*time.Millisecond, func(c Changed) { changes <- c }); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "live.css")
	for i := range 5 {
		if err := os.WriteFile(path, []byte(":root{--n:"+string(rune('0'+i))+"}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	select {
	case c := <-changes:
		if c.File != "live.css" || c.Hash == "" {
			t.Fatalf("unexpected change %+v", c)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no change reported")
	}
	select {
	case c := <-changes:
		t.Fatalf("burst should be one event, got another: %+v", c)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestWatchFollowsPackageFolders(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "old"), 0o755)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	changes := make(chan Changed, 10)
	if err := Watch(ctx, dir, 50*time.Millisecond, func(c Changed) { changes <- c }); err != nil {
		t.Fatal(err)
	}
	wait := func(want string) {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case c := <-changes:
				if c.File == want {
					return
				}
			case <-deadline:
				t.Fatalf("no change for %s", want)
			}
		}
	}
	os.WriteFile(filepath.Join(dir, "old", "palette.css"), []byte(":root{}"), 0o644)
	wait("old/palette.css")
	// a package folder created while running
	os.MkdirAll(filepath.Join(dir, "new"), 0o755)
	time.Sleep(150 * time.Millisecond)
	os.WriteFile(filepath.Join(dir, "new", "manifest.json"), []byte("{}"), 0o644)
	wait("new/manifest.json")
}
