package services

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/systheme"
)

type SystemTheme struct {
	provider systheme.Provider
	emit     events.Emitter

	mu     sync.Mutex
	last   systheme.SystemPalette
	cancel context.CancelFunc
}

func NewSystemTheme(p systheme.Provider, emit events.Emitter) *SystemTheme {
	return &SystemTheme{provider: p, emit: emit, last: p.Read()}
}

func (s *SystemTheme) Get() systheme.SystemPalette {
	p := s.provider.Read()
	s.mu.Lock()
	s.last = p
	s.mu.Unlock()
	return p
}

// Current is the last palette read, without asking the OS again.
func (s *SystemTheme) Current() systheme.SystemPalette {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.last
}

func (s *SystemTheme) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	ctx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	go s.provider.Watch(ctx, s.refresh)
	return nil
}

func (s *SystemTheme) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func (s *SystemTheme) refresh() {
	p := s.provider.Read()
	s.mu.Lock()
	changed := !p.Equal(s.last)
	s.last = p
	s.mu.Unlock()
	if changed {
		s.emit.Emit(events.SystemThemeChanged, p)
	}
}
