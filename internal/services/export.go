package services

import (
	"context"
	"errors"
	"sync"

	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/export"
)

// FolderPicker asks for a folder; the app wires it to the native dialog.
type FolderPicker interface {
	PickFolder(title string) (string, error)
}

type Export struct {
	c      *core.Core
	picker FolderPicker

	mu     sync.Mutex
	cancel context.CancelFunc
}

func NewExport(c *core.Core, p FolderPicker) *Export { return &Export{c: c, picker: p} }

var errExportRunning = errors.New("an export is already running")

// Run asks where to put the export and writes it there, sending export:progress along the way.
// It returns the folder it made, or "" when the folder dialog was cancelled.
func (e *Export) Run(opts domain.ExportOptions) (string, error) {
	e.mu.Lock()
	if e.cancel != nil {
		e.mu.Unlock()
		return "", errExportRunning
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()
	defer func() {
		cancel()
		e.mu.Lock()
		e.cancel = nil
		e.mu.Unlock()
	}()

	dir, err := e.picker.PickFolder("Export chat to…")
	if err != nil || dir == "" {
		return "", err
	}
	progress := func(phase string, done, total int) {
		e.c.Emit.Emit(events.ExportProg, domain.ExportProgressEvent{JID: opts.JID, Phase: phase, Done: done, Total: total})
	}
	job := &export.Job{
		DB: e.c.DB, View: e.c.View(ctx), Media: e.c.Media, MediaDir: e.c.Paths.Media,
		Opts: opts, Dir: dir, Progress: progress,
	}
	out, err := job.Run(ctx)
	switch {
	case errors.Is(err, context.Canceled):
		progress("cancelled", 0, 0)
		return "", errors.New("export cancelled")
	case err != nil:
		progress("failed", 0, 0)
		return "", err
	}
	progress("done", 0, 0)
	return out, nil
}

func (e *Export) Cancel() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		e.cancel()
	}
}

// Reveal opens a finished export's folder.
func (e *Export) Open(folder string) error {
	return e.c.OpenFolder(folder)
}
