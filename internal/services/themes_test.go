package services

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakePicker struct{ path string }

func (f fakePicker) PickFile(string) (string, error) { return f.path, nil }

func TestPickWallpaper(t *testing.T) {
	src := t.TempDir()
	var img bytes.Buffer
	png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	pic := filepath.Join(src, "beach.PNG")
	os.WriteFile(pic, img.Bytes(), 0o644)
	fake := filepath.Join(src, "notes.png")
	os.WriteFile(fake, []byte("just text"), 0o644)
	doc := filepath.Join(src, "a.pdf")
	os.WriteFile(doc, []byte("%PDF"), 0o644)

	dir := t.TempDir()
	rel, err := NewThemes(dir, nil, fakePicker{pic}).PickWallpaper()
	if err != nil || !strings.HasPrefix(rel, "_wallpapers/") || !strings.HasSuffix(rel, ".png") {
		t.Fatalf("rel=%q err=%v", rel, err)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(rel))); err != nil {
		t.Errorf("not copied: %v", err)
	}
	if _, err := NewThemes(dir, nil, fakePicker{fake}).PickWallpaper(); err == nil {
		t.Error("a text file renamed to .png was accepted")
	}
	if _, err := NewThemes(dir, nil, fakePicker{doc}).PickWallpaper(); err == nil {
		t.Error("a pdf was accepted")
	}
	if rel, err := NewThemes(dir, nil, fakePicker{""}).PickWallpaper(); rel != "" || err != nil {
		t.Errorf("cancel: %q %v", rel, err)
	}
}
