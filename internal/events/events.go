package events

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/whatszori/WhatsZori/internal/systheme"
	"github.com/whatszori/WhatsZori/internal/themes"
)

// Keep in sync with frontend/src/api/events.ts (events_test.go checks the names).
const (
	SystemThemeChanged = "wz:systheme:changed"
	ThemeChanged       = "wz:theme:changed"
)

// All lists every event name, for the sync test.
var All = []string{SystemThemeChanged, ThemeChanged}

func init() {
	// registered events are type-checked on emit, and the binding generator sees them
	application.RegisterEvent[systheme.SystemPalette](SystemThemeChanged)
	application.RegisterEvent[themes.Changed](ThemeChanged)
}

type Emitter interface {
	Emit(name string, data any)
}

// Wails emits through the running application. Before Run (or in tests) there's no app, and the
// event is dropped, which is fine since nothing could be listening yet.
type Wails struct{}

func (Wails) Emit(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}

type Discard struct{}

func (Discard) Emit(string, any) {}
