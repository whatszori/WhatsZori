//go:build darwin

package systheme

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// Stub: only the light/dark scheme, read from the global AppleInterfaceStyle default.
type darwinProvider struct{}

func New() Provider { return darwinProvider{} }

func (darwinProvider) Read() SystemPalette {
	p := SystemPalette{Source: "macos", Scheme: SchemeLight, Raw: map[string]string{}}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// exits non-zero when the key is unset, which means light mode
	out, err := exec.CommandContext(ctx, "defaults", "read", "-g", "AppleInterfaceStyle").Output()
	if err == nil {
		v := strings.TrimSpace(string(out))
		p.Raw["AppleInterfaceStyle"] = v
		if strings.EqualFold(v, "dark") {
			p.Scheme = SchemeDark
		}
	}
	return finish(p)
}

func (darwinProvider) Watch(context.Context, func()) {}
