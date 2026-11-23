package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/themes"
)

const themeDebounce = 100 * time.Millisecond

// Themes lists the user's CSS themes from <config>/themes and reports edits to them.
type Themes struct {
	dir    string
	emit   events.Emitter
	picker FilePicker
}

func NewThemes(dir string, emit events.Emitter, picker FilePicker) *Themes {
	return &Themes{dir: dir, emit: emit, picker: picker}
}

// Packages lists theme folders (manifest.json + CSS modules), like the built-in themes.
func (t *Themes) Packages() ([]themes.Package, error) {
	return themes.Packages(t.dir)
}

const (
	wallpaperDir      = "_wallpapers"
	maxWallpaperBytes = 25 << 20
)

var wallpaperExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}

// PickWallpaper asks for an image and copies it into <config>/themes/_wallpapers. It returns the
// path to use under /wz-themes/, or "" when the user cancelled.
func (t *Themes) PickWallpaper() (string, error) {
	if t.picker == nil {
		return "", errNoPicker
	}
	src, err := t.picker.PickFile("Choose a chat wallpaper")
	if err != nil || src == "" {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(src))
	if !wallpaperExts[ext] {
		return "", errors.New("pick a JPEG, PNG, WebP or GIF image")
	}
	st, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if st.Size() > maxWallpaperBytes {
		return "", fmt.Errorf("the image can be at most %d MB", maxWallpaperBytes>>20)
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(http.DetectContentType(data), "image/") {
		return "", errors.New("that file isn't an image")
	}
	name := themes.Hash(data) + ext
	if err := os.MkdirAll(filepath.Join(t.dir, wallpaperDir), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(t.dir, wallpaperDir, name), data, 0o644); err != nil {
		return "", err
	}
	return wallpaperDir + "/" + name, nil
}

func (t *Themes) List() ([]themes.Info, error) {
	return themes.List(t.dir)
}

func (t *Themes) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	err := themes.Watch(ctx, t.dir, themeDebounce, func(c themes.Changed) {
		t.emit.Emit(events.ThemeChanged, c)
	})
	if err != nil {
		// hot reload is a nicety, the app works without it
		slog.Warn("theme watcher not running", "dir", t.dir, "error", err)
	}
	return nil
}
