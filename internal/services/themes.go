package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/themes"
)

const themeDebounce = 100 * time.Millisecond

// Themes lists the user's CSS themes from <config>/themes and reports edits to them.
type Themes struct {
	dir  string
	emit events.Emitter
}

func NewThemes(dir string, emit events.Emitter) *Themes {
	return &Themes{dir: dir, emit: emit}
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
