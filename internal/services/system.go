package services

import (
	"fmt"
	"net/url"
	"runtime"
	"strings"

	"github.com/whatszori/WhatsZori/internal/boot"
	"github.com/whatszori/WhatsZori/internal/config"
)

// Shell is what System needs from the OS. The app wires it to Wails' Browser and Env managers.
type Shell interface {
	OpenURL(url string) error
	OpenFolder(path string) error
}

type System struct {
	version string
	paths   config.Paths
	boot    *boot.Sentinel
	shell   Shell
}

func NewSystem(version string, paths config.Paths, b *boot.Sentinel, shell Shell) *System {
	return &System{version: version, paths: paths, boot: b, shell: shell}
}

func (s *System) Version() string { return s.version }

func (s *System) Platform() string { return runtime.GOOS }

func (s *System) IsSafeMode() bool { return s.boot.SafeMode() }

// BootOK is called by the frontend once it has been up for a few seconds.
func (s *System) BootOK() error { return s.boot.OK() }

func (s *System) ConfigDir() string { return s.paths.Root }

// OpenExternal only opens web and mail links. Anything else (file:, custom protocol handlers)
// could launch programs, and message text is untrusted.
func (s *System) OpenExternal(rawURL string) error {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return fmt.Errorf("bad url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		if u.Host == "" {
			return fmt.Errorf("url has no host")
		}
	case "mailto":
	default:
		return fmt.Errorf("refusing to open %q links", u.Scheme)
	}
	return s.shell.OpenURL(u.String())
}

// OpenConfigFolder opens the config folder ("" or "root") or one of themes/plugins/media.
func (s *System) OpenConfigFolder(kind string) error {
	dir, ok := s.paths.Dir(kind)
	if !ok {
		return fmt.Errorf("unknown folder %q", kind)
	}
	if err := s.paths.Ensure(); err != nil {
		return err
	}
	return s.shell.OpenFolder(dir)
}
