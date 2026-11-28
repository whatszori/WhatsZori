package services

import (
	"context"
	"errors"
	"fmt"
	"go.mau.fi/whatsmeow/types"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/clip"
	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/media"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Desktop is what Media needs from the OS: a save dialog and "show in folder". The app wires it
// to Wails.
type Desktop interface {
	PickSavePath(title, defaultName string) (string, error)
	RevealFile(path string) error
}

// Media gives the viewer its file actions: save, copy to the clipboard, show in folder.
type Media struct {
	c       *core.Core
	desktop Desktop
}

func NewMedia(c *core.Core, d Desktop) *Media { return &Media{c: c, desktop: d} }

// local makes sure the file is downloaded and returns its absolute path and a suggested name.
func (m *Media) local(pk string) (string, string, repo.MediaRow, error) {
	id, err := parsePK(pk)
	if err != nil {
		return "", "", repo.MediaRow{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	row, err := m.c.Media.Ensure(ctx, id)
	if errors.Is(err, media.ErrExpired) {
		return "", "", row, errors.New("this file is no longer on WhatsApp's servers")
	} else if errors.Is(err, media.ErrNoDownload) {
		return "", "", row, errors.New("not downloaded yet, and you're offline")
	} else if err != nil {
		return "", "", row, err
	}
	rel, err := assets.SafeRel(row.LocalPath)
	if err != nil {
		return "", "", row, err
	}
	name := row.FileName
	if name == "" {
		ts := time.Now()
		if msg, err := repo.GetMessage(ctx, m.c.DB, id); err == nil {
			ts = time.UnixMilli(msg.TS)
		}
		name = "WhatsZori " + ts.Format("2006-01-02 15.04.05") + filepath.Ext(rel)
	}
	return filepath.Join(m.c.Paths.Media, filepath.FromSlash(rel)), sanitizeName(name), row, nil
}

// SaveAs asks where to save the file and copies it there. It returns the chosen path, or "" when
// the dialog was cancelled.
func (m *Media) SaveAs(pk string) (string, error) {
	src, name, _, err := m.local(pk)
	if err != nil {
		return "", err
	}
	dst, err := m.desktop.PickSavePath("Save file", name)
	if err != nil || dst == "" {
		return "", err
	}
	if err := copyFileTo(src, dst); err != nil {
		return "", fmt.Errorf("couldn't save: %w", err)
	}
	return dst, nil
}

// Copy puts the file on the clipboard. Pictures also go on as a picture, so they paste into
// chats and editors, not just file managers.
func (m *Media) Copy(pk string) error {
	src, _, row, err := m.local(pk)
	if err != nil {
		return err
	}
	var data []byte
	if row.MediaType == "image" && row.Size < 40<<20 {
		data, _ = os.ReadFile(src)
	}
	return clip.Copy(src, data)
}

// SaveAvatar saves someone's (or a group's) full-size profile picture where the user picks.
// Returns the path, or "" when they cancelled.
func (m *Media) SaveAvatar(jid, name string) (string, error) {
	src, err := m.avatarPath(jid)
	if err != nil {
		return "", err
	}
	if name = strings.TrimSpace(name); name == "" {
		name = "profile picture"
	}
	dst, err := m.desktop.PickSavePath("Save profile picture", safeFileName(name)+".jpg")
	if err != nil || dst == "" {
		return "", err
	}
	if err := copyFileTo(src, dst); err != nil {
		return "", fmt.Errorf("couldn't save: %w", err)
	}
	return dst, nil
}

// CopyAvatar puts the full-size profile picture on the clipboard, as a file and a picture.
func (m *Media) CopyAvatar(jid string) error {
	src, err := m.avatarPath(jid)
	if err != nil {
		return err
	}
	data, _ := os.ReadFile(src)
	return clip.Copy(src, data)
}

func (m *Media) avatarPath(jid string) (string, error) {
	j, err := types.ParseJID(jid)
	if err != nil {
		return "", errors.New("bad jid")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := m.c.Avatars.FullPath(ctx, j)
	if err != nil {
		return "", errors.New("there's no profile picture to save (or it's hidden)")
	}
	return p, nil
}

// safeFileName keeps a name usable as a file name on every system
func safeFileName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return -1
		}
		return r
	}, s)
	if r := []rune(s); len(r) > 80 {
		s = string(r[:80])
	}
	return strings.TrimSpace(s)
}

// Reveal opens the media folder with the file selected.
func (m *Media) Reveal(pk string) error {
	src, _, _, err := m.local(pk)
	if err != nil {
		return err
	}
	return m.desktop.RevealFile(src)
}

func copyFileTo(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// file names come from the sender; keep them from carrying paths or characters Windows refuses
func sanitizeName(name string) string {
	// path.Base, not filepath: on Windows filepath would read "a:b" as a drive
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	return name
}
