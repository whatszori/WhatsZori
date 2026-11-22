package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const dirName = "whatszori"

// EnvDir overrides the config folder, handy for trying a build without touching the real one.
const EnvDir = "WHATSZORI_CONFIG_DIR"

type Paths struct {
	Root    string
	Themes  string
	Plugins string
	Media   string
}

func (p Paths) SettingsFile() string { return filepath.Join(p.Root, "settings.json") }
func (p Paths) BootMarker() string   { return filepath.Join(p.Root, "boot.pending") }

// SessionDB is whatsmeow's own store (keys, device); DataDB is ours (chats, messages, media).
func (p Paths) SessionDB() string { return filepath.Join(p.Root, "session.db") }
func (p Paths) DataDB() string    { return filepath.Join(p.Root, "whatszori.db") }

// Dir maps the folder kinds the frontend knows about to real paths.
func (p Paths) Dir(kind string) (string, bool) {
	switch kind {
	case "", "root", "config":
		return p.Root, true
	case "themes":
		return p.Themes, true
	case "plugins":
		return p.Plugins, true
	case "media":
		return p.Media, true
	}
	return "", false
}

// EnvNoConnect keeps the WhatsApp client offline (no QR, no reconnect). For smoke-testing a build
// without talking to WhatsApp.
const EnvNoConnect = "WHATSZORI_NO_CONNECT"

type Flags struct {
	SafeMode  bool
	NoConnect bool
}

type Config struct {
	Paths Paths
	Flags Flags
}

func Load(args []string) (Config, error) {
	root := os.Getenv(EnvDir)
	if root == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return Config{}, fmt.Errorf("find user config dir: %w", err)
		}
		root = filepath.Join(base, dirName)
	}
	paths := NewPaths(root)
	if err := paths.Ensure(); err != nil {
		return Config{}, err
	}
	flags := ParseFlags(args)
	if v := os.Getenv(EnvNoConnect); v != "" && v != "0" {
		flags.NoConnect = true
	}
	return Config{Paths: paths, Flags: flags}, nil
}

func NewPaths(root string) Paths {
	return Paths{
		Root:    root,
		Themes:  filepath.Join(root, "themes"),
		Plugins: filepath.Join(root, "plugins"),
		Media:   filepath.Join(root, "media"),
	}
}

func (p Paths) Ensure() error {
	var errs []error
	for _, dir := range []string{p.Root, p.Themes, p.Plugins, p.Media} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// ParseFlags only looks for the flags we know. The flag package would stop at anything unknown,
// and the OS or a launcher may pass extra arguments.
func ParseFlags(args []string) Flags {
	var f Flags
	for _, a := range args {
		switch a {
		case "--safe-mode", "-safe-mode":
			f.SafeMode = true
		}
	}
	return f
}
