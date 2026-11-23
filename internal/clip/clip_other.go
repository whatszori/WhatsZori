//go:build !windows

package clip

import (
	"bytes"
	"net/url"
	"os/exec"
	"path/filepath"
)

// Linux: a file manager pastes a text/uri-list. Needs wl-copy (Wayland) or xclip (X11).
func copyFile(path string, _ *Picture) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}).String() + "\r\n"
	for _, cmd := range [][]string{
		{"wl-copy", "--type", "text/uri-list"},
		{"xclip", "-selection", "clipboard", "-t", "text/uri-list"},
	} {
		if _, err := exec.LookPath(cmd[0]); err != nil {
			continue
		}
		c := exec.Command(cmd[0], cmd[1:]...)
		c.Stdin = bytes.NewBufferString(uri)
		if err := c.Run(); err == nil {
			return nil
		}
	}
	return ErrUnsupported
}
