package themes

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Packages are themes shaped like the built-in ones: a folder <config>/themes/<id>/ with a
// manifest.json listing CSS modules the user can switch on and off.

type ModuleInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	File        string `json:"file"`
	Required    bool   `json:"required,omitempty"`
	// starting state for optional modules; on when left out
	Default *bool `json:"default,omitempty"`
}

type Manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	// panels | rail: the layout it was made for
	Layout  string       `json:"layout,omitempty"`
	Modules []ModuleInfo `json:"modules"`
}

type Package struct {
	Manifest Manifest `json:"manifest"`
	// module file -> CSS, with relative url()s pointing into the package folder
	CSS map[string]string `json:"css"`
	// why it can't be used; empty when fine
	Error string `json:"error,omitempty"`
}

const (
	maxManifestBytes = 64 << 10
	maxCSSBytes      = 1 << 20
)

var idRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// IsPackageDir tells theme package folders from the rest (assets, "_wallpapers", hidden ones).
func IsPackageDir(name string) bool {
	return !strings.HasPrefix(name, "_") && !strings.HasPrefix(name, ".")
}

// Packages reads every package folder in dir. Broken ones come back with Error set.
func Packages(dir string) ([]Package, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []Package{}
	for _, e := range entries {
		if !e.IsDir() || !IsPackageDir(e.Name()) {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, e.Name(), "manifest.json")); err != nil {
			continue // a folder of assets for a single-file theme
		}
		out = append(out, readPackage(dir, e.Name()))
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Manifest.Name) < strings.ToLower(out[j].Manifest.Name)
	})
	return out, nil
}

func readPackage(dir, folder string) Package {
	p := Package{Manifest: Manifest{ID: folder, Name: folder, Modules: []ModuleInfo{}}, CSS: map[string]string{}}
	fail := func(format string, a ...any) Package {
		p.Error = fmt.Sprintf(format, a...)
		p.CSS = map[string]string{}
		// listed under its folder name, whatever the manifest says
		p.Manifest.ID = folder
		return p
	}
	if !idRe.MatchString(folder) {
		return fail("the folder name can only have letters, digits, dots, dashes and underscores")
	}
	raw, err := readLimited(filepath.Join(dir, folder, "manifest.json"), maxManifestBytes)
	if err != nil {
		return fail("manifest.json: %v", err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return fail("manifest.json isn't valid JSON: %v", err)
	}
	if m.Name == "" {
		m.Name = folder
	}
	if m.Modules == nil {
		m.Modules = []ModuleInfo{}
	}
	p.Manifest = m
	if m.ID != folder {
		return fail("the manifest id %q must match the folder name", m.ID)
	}
	if m.Layout != "" && m.Layout != "panels" && m.Layout != "rail" {
		return fail(`layout must be "panels" or "rail"`)
	}
	if len(m.Modules) == 0 {
		return fail("the manifest lists no modules")
	}
	seen := map[string]bool{}
	for _, mod := range m.Modules {
		if mod.ID == "" || seen[mod.ID] {
			return fail("every module needs its own id")
		}
		seen[mod.ID] = true
		if !validCSSPath(mod.File) {
			return fail("module %q: file must be a .css file inside the theme folder", mod.ID)
		}
		css, err := readLimited(filepath.Join(dir, folder, filepath.FromSlash(mod.File)), maxCSSBytes)
		if err != nil {
			return fail("module %q: %v", mod.ID, err)
		}
		p.CSS[mod.File] = RewriteURLs(strings.TrimPrefix(string(css), bom), "/wz-themes/"+folder+"/"+path.Dir(mod.File))
	}
	return p
}

func validCSSPath(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:\x00") || path.Clean(p) != p {
		return false
	}
	for seg := range strings.SplitSeq(p, "/") {
		if seg == ".." || seg == "." {
			return false
		}
	}
	return strings.EqualFold(path.Ext(p), ".css")
}

var errTooBig = errors.New("file is too big")

func readLimited(name string, limit int64) ([]byte, error) {
	f, err := os.Open(name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("file is missing")
		}
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, errTooBig
	}
	return b, nil
}

var urlRe = regexp.MustCompile(`url\(\s*(['"]?)([^'")]*)(['"]?)\s*\)`)

// RewriteURLs points relative url()s at base, since the CSS ends up inline in the page rather
// than at its own address. Absolute, data: and fragment URLs are left alone.
func RewriteURLs(css, base string) string {
	return urlRe.ReplaceAllStringFunc(css, func(m string) string {
		parts := urlRe.FindStringSubmatch(m)
		target := strings.TrimSpace(parts[2])
		if target == "" || strings.HasPrefix(target, "/") || strings.HasPrefix(target, "#") || strings.Contains(target, ":") {
			return m
		}
		return `url("` + path.Join(base, target) + `")`
	})
}
