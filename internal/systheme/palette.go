package systheme

import (
	"context"
	"maps"
)

type SystemPalette struct {
	Source   string            `json:"source"`
	Scheme   string            `json:"scheme"` // "dark" | "light" | "none"
	Accent   string            `json:"accent"` // "#rrggbb", empty if unknown
	AccentFg string            `json:"accentFg"`
	Raw      map[string]string `json:"raw"`
}

const (
	SchemeDark  = "dark"
	SchemeLight = "light"
	SchemeNone  = "none"
)

func (p SystemPalette) Equal(o SystemPalette) bool {
	return p.Source == o.Source && p.Scheme == o.Scheme && p.Accent == o.Accent &&
		p.AccentFg == o.AccentFg && maps.Equal(p.Raw, o.Raw)
}

// IsDark treats "none" as light, which is what every OS does when nothing is set.
func (p SystemPalette) IsDark() bool { return p.Scheme == SchemeDark }

type Provider interface {
	Read() SystemPalette
	// Watch calls changed whenever the OS setting might have changed, until ctx is done.
	// It may return right away if the platform can't watch.
	Watch(ctx context.Context, changed func())
}

func finish(p SystemPalette) SystemPalette {
	if p.Scheme == "" {
		p.Scheme = SchemeNone
	}
	if p.Raw == nil {
		p.Raw = map[string]string{}
	}
	if p.Accent != "" {
		p.AccentFg = AccentForeground(p.Accent)
	}
	return p
}

type staticProvider struct{ p SystemPalette }

func (s staticProvider) Read() SystemPalette           { return s.p }
func (s staticProvider) Watch(context.Context, func()) {}
func Static(p SystemPalette) Provider                  { return staticProvider{finish(p)} }
