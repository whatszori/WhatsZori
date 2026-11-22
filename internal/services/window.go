package services

import (
	"fmt"

	"github.com/whatszori/WhatsZori/internal/systheme"
)

// ThemeTarget is the main window as far as theming goes; the app implements it.
type ThemeTarget interface {
	ApplyTheme(dark bool, background string)
}

type Window struct {
	target ThemeTarget
}

func NewWindow(target ThemeTarget) *Window { return &Window{target: target} }

// SetTheme is called by the frontend whenever the resolved theme changes. The background is the
// page's actual background, so the native window (resize gaps, next startup) matches it.
func (w *Window) SetTheme(dark bool, background string) error {
	if background != "" {
		if _, _, _, ok := systheme.ParseHex(background); !ok {
			return fmt.Errorf("background must be #rrggbb, got %q", background)
		}
	}
	w.target.ApplyTheme(dark, background)
	return nil
}
