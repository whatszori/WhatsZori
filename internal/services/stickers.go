package services

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/sticker"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/themes"
)

// Stickers is the sticker tab of the emoji picker: the user's own stickers from <config>/stickers
// and the ones recently seen in chats.
type Stickers struct {
	c   *core.Core
	dir string
}

func NewStickers(c *core.Core, dir string) *Stickers { return &Stickers{c: c, dir: dir} }

const recentPrefix = "pk:"

var errNoSticker = errors.New("that sticker is gone")

// Mine lists the stickers in the stickers folder, newest first.
func (s *Stickers) Mine() ([]domain.Sticker, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	type item struct {
		st domain.Sticker
		at int64
	}
	var items []item
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".webp") || !assets.ValidPluginID(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{domain.Sticker{ID: e.Name(), URL: assets.StickersPrefix + e.Name()}, info.ModTime().UnixNano()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].at > items[j].at })
	out := make([]domain.Sticker, len(items))
	for i, it := range items {
		out[i] = it.st
	}
	return out, nil
}

// Recent lists stickers from chats (received or sent) that we have the file for, newest first,
// one per picture.
func (s *Stickers) Recent() ([]domain.Sticker, error) {
	ctx, cancel := call()
	defer cancel()
	pks, err := repo.RecentStickers(ctx, s.c.DB, 48)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Sticker, 0, len(pks))
	for _, pk := range pks {
		id := strconv.FormatInt(pk, 10)
		out = append(out, domain.Sticker{ID: recentPrefix + id, URL: assets.MediaPrefix + id})
	}
	return out, nil
}

// Add makes a sticker from a picture (base64) and keeps it in the stickers folder.
func (s *Stickers) Add(data string) (domain.Sticker, error) {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return domain.Sticker{}, sticker.ErrNotImage
	}
	webp, err := sticker.Prepare(raw)
	if err != nil {
		return domain.Sticker{}, err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return domain.Sticker{}, err
	}
	name := themes.Hash(webp) + ".webp"
	if err := os.WriteFile(filepath.Join(s.dir, name), webp, 0o644); err != nil {
		return domain.Sticker{}, err
	}
	return domain.Sticker{ID: name, URL: assets.StickersPrefix + name}, nil
}

// Remove deletes one of the user's own stickers.
func (s *Stickers) Remove(id string) error {
	if !assets.ValidPluginID(id) || !strings.EqualFold(filepath.Ext(id), ".webp") {
		return errNoSticker
	}
	err := os.Remove(filepath.Join(s.dir, id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Send sends a sticker from either list to jid.
func (s *Stickers) Send(jid, id string) (domain.Message, error) {
	ctx, cancel := call()
	defer cancel()
	if pk, ok := strings.CutPrefix(id, recentPrefix); ok {
		n, err := parsePK(pk)
		if err != nil {
			return domain.Message{}, err
		}
		return s.c.Sender.ResendSticker(ctx, n, jid)
	}
	if !assets.ValidPluginID(id) || !strings.EqualFold(filepath.Ext(id), ".webp") {
		return domain.Message{}, errNoSticker
	}
	data, err := os.ReadFile(filepath.Join(s.dir, id))
	if err != nil {
		return domain.Message{}, errNoSticker
	}
	webp, err := sticker.Prepare(data)
	if err != nil {
		return domain.Message{}, err
	}
	return s.c.Sender.SendSticker(ctx, jid, webp)
}
