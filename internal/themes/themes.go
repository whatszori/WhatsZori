package themes

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var bom = string(rune(0xfeff))

type Meta struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Description string `json:"description"`
}

type Info struct {
	Meta
	File string `json:"file"`
	Hash string `json:"hash"`
}

// Changed is the payload of wz:theme:changed. Hash is empty when the file was removed.
type Changed struct {
	File string `json:"file"`
	Hash string `json:"hash"`
}

// ParseMeta reads @name, @id, @author, @version and @description from the first block
// comment, as long as that comment is the first thing in the file.
func ParseMeta(css []byte) Meta {
	var m Meta
	s := strings.TrimPrefix(string(css), bom)
	s = strings.TrimLeft(s, " \t\r\n")
	if !strings.HasPrefix(s, "/*") {
		return m
	}
	end := strings.Index(s, "*/")
	if end < 0 {
		return m
	}
	for line := range strings.SplitSeq(s[2:end], "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimSpace(strings.TrimLeft(line, "*"))
		if !strings.HasPrefix(line, "@") {
			continue
		}
		key, value, _ := strings.Cut(line[1:], " ")
		value = strings.TrimSpace(value)
		switch strings.ToLower(key) {
		case "name":
			m.Name = value
		case "id":
			m.ID = value
		case "author":
			m.Author = value
		case "version":
			m.Version = value
		case "description":
			m.Description = value
		}
	}
	return m
}

func Hash(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:6])
}

func IsThemeFile(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".css") && !strings.HasPrefix(name, ".")
}

// List returns the .css files directly inside dir. Subfolders are for a theme's own assets.
func List(dir string) ([]Info, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []Info{}
	for _, e := range entries {
		if e.IsDir() || !IsThemeFile(e.Name()) {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		info := Info{Meta: ParseMeta(content), File: e.Name(), Hash: Hash(content)}
		base := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		if info.ID == "" {
			info.ID = base
		}
		if info.Name == "" {
			info.Name = base
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}
