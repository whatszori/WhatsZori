// Package plugins reads plugin folders: the manifest and its rules, signatures, the permissions a
// plugin asks for and the network proxy that only reaches the domains it lists. The plugin code
// itself runs in the webview; nothing from a plugin folder is executed here.
package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// APIVersion is the newest plugin API this build provides. A manifest without apiVersion is 1,
// the first API (no permissions, everything it had is allowed).
const APIVersion = 2

const maxManifest = 64 << 10

// Permissions a v2 plugin can ask for. Anything not listed here is refused when the manifest is
// read, so a typo doesn't silently give a plugin nothing (or more than it thinks).
var Permissions = map[string]string{
	"messages":      "Read your messages, search them, and see edits and deletions as they happen",
	"contacts":      "See your contacts, group members and your own profile",
	"media":         "Show photos, videos and profile pictures from your chats",
	"composer":      "Write into the message box and add attachments (you still press Send)",
	"notifications": "Show desktop notifications",
	"clipboard":     "Copy text and pictures to the clipboard",
	"files":         "Save files to your computer, in a place you pick",
	"chats.manage":  "Pin, mute and archive chats when you click its buttons (your phone sees this)",
	"presence":      "See who is online and who is typing",
	"network":       "Connect to the internet sites listed below",
}

// v1 plugins had read access to messages and the message box, without asking
var legacyPermissions = []string{"messages", "composer"}

var settingTypes = map[string]bool{
	"text": true, "password": true, "textarea": true, "toggle": true, "select": true, "number": true,
}

type Manifest struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Version       string    `json:"version"`
	Description   string    `json:"description"`
	Author        string    `json:"author"`
	Homepage      string    `json:"homepage"`
	Main          string    `json:"main"`
	Icon          string    `json:"icon"`
	APIVersion    int       `json:"apiVersion"`
	MinAppVersion string    `json:"minAppVersion"`
	Permissions   []string  `json:"permissions"`
	Network       []string  `json:"network"`
	Settings      []Setting `json:"settings"`
	// runs in an isolated frame with a declarative UI instead of in the page
	Sandbox bool `json:"sandbox"`
}

// Setting is one field of the settings form WhatsZori draws for the plugin.
type Setting struct {
	Key         string   `json:"key"`
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Description string   `json:"description,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Default     any      `json:"default,omitempty"`
	Options     []Option `json:"options,omitempty"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
}

type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

var (
	idRe      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	versionRe = regexp.MustCompile(`^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$`)
	keyRe     = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	hostRe    = regexp.MustCompile(`^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
)

// Read parses <dir>/<folder>/manifest.json. A problem with the file is an error; problems with
// what it says are in the returned list, so the app can show all of them at once.
func Read(dir, folder string) (Manifest, error) {
	var m Manifest
	f, err := os.Open(filepath.Join(dir, folder, "manifest.json"))
	if err != nil {
		return m, errors.New("no manifest.json")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxManifest+1))
	if err != nil {
		return m, err
	}
	if len(data) > maxManifest {
		return m, errors.New("manifest.json is too big")
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, errors.New("manifest.json isn't valid JSON: " + err.Error())
	}
	if m.Main == "" {
		m.Main = "index.js"
	}
	if m.APIVersion == 0 {
		m.APIVersion = 1
	}
	return m, nil
}

// Problems lists what's wrong with a manifest, in the order the fields appear. appVersion is the
// running WhatsZori ("" skips the minAppVersion check).
func (m Manifest) Problems(folder, appVersion string) []string {
	var out []string
	add := func(format string, a ...any) { out = append(out, fmt.Sprintf(format, a...)) }
	switch {
	case m.ID != folder:
		add("the manifest id %q must match the folder name", m.ID)
	case !idRe.MatchString(m.ID) || strings.Contains(m.ID, ".."):
		add("the id can only have letters, digits, dots, dashes and underscores")
	}
	if strings.TrimSpace(m.Name) == "" {
		add("name is missing")
	}
	if m.Version != "" && !versionRe.MatchString(m.Version) {
		add("version should look like 1.0.0")
	}
	if !SafeRel(m.Main) || !isJS(m.Main) {
		add("main must be a .js or .mjs file inside the plugin folder")
	}
	if m.Icon != "" && (!SafeRel(m.Icon) || !isImage(m.Icon)) {
		add("icon must be a .png, .svg, .jpg or .webp file inside the plugin folder")
	}
	if m.Homepage != "" && !strings.HasPrefix(m.Homepage, "https://") {
		add("homepage must start with https://")
	}
	if m.APIVersion < 1 || m.APIVersion > APIVersion {
		add("it needs plugin API %d, this WhatsZori has %d; update WhatsZori", m.APIVersion, APIVersion)
	}
	if m.MinAppVersion != "" {
		if !versionRe.MatchString(m.MinAppVersion) {
			add("minAppVersion should look like 0.2.0")
		} else if appVersion != "" && compareVersions(appVersion, m.MinAppVersion) < 0 {
			add("it needs WhatsZori %s or newer (this is %s)", m.MinAppVersion, appVersion)
		}
	}
	if m.APIVersion == 1 && (len(m.Permissions) > 0 || len(m.Network) > 0 || len(m.Settings) > 0 || m.Sandbox) {
		add(`permissions, network, settings and sandbox need "apiVersion": 2`)
	}
	seen := map[string]bool{}
	for _, p := range m.Permissions {
		if _, ok := Permissions[p]; !ok {
			add("unknown permission %q", p)
		} else if seen[p] {
			add("permission %q is listed twice", p)
		}
		seen[p] = true
	}
	if len(m.Network) > 0 && !seen["network"] {
		add(`network lists sites, so permissions needs "network" too`)
	}
	if seen["network"] && len(m.Network) == 0 {
		add(`the "network" permission needs the sites it connects to in "network"`)
	}
	for _, d := range m.Network {
		if err := checkPattern(d); err != nil {
			add("network %q: %v", d, err)
		}
	}
	keys := map[string]bool{}
	for i, s := range m.Settings {
		where := fmt.Sprintf("settings[%d]", i)
		if !keyRe.MatchString(s.Key) {
			add("%s: key must be 1 to 64 letters, digits, '_', '.', '-'", where)
		} else if keys[s.Key] {
			add("%s: key %q is used twice", where, s.Key)
		}
		keys[s.Key] = true
		if !settingTypes[s.Type] {
			add("%s: type must be text, password, textarea, toggle, select or number", where)
		}
		if strings.TrimSpace(s.Label) == "" {
			add("%s: label is missing", where)
		}
		if s.Type == "select" && len(s.Options) == 0 {
			add("%s: a select needs options", where)
		}
	}
	return out
}

// Requested is what the user is asked to allow: the listed permissions, or for a v1 plugin the
// ones the first API gave every plugin.
func (m Manifest) Requested() []string {
	if m.APIVersion == 1 {
		return legacyPermissions
	}
	if m.Permissions == nil {
		return []string{}
	}
	return m.Permissions
}

func isJS(p string) bool {
	ext := strings.ToLower(path.Ext(p))
	return ext == ".js" || ext == ".mjs"
}

func isImage(p string) bool {
	switch strings.ToLower(path.Ext(p)) {
	case ".png", ".svg", ".jpg", ".jpeg", ".webp":
		return true
	}
	return false
}

// SafeRel: a forward-slash path inside the folder, no "..", no drive, nothing Windows refuses
func SafeRel(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:\x00") {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || seg == "." || seg == ".." || strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " ") {
			return false
		}
	}
	return true
}

// checkPattern: "api.example.com", "*.example.com", optionally ":port". localhost and 127.0.0.1
// are allowed (plain http then); bare IPs and "*" aren't.
func checkPattern(p string) error {
	if strings.Contains(p, "/") {
		return errors.New("only the host name, without https:// or a path")
	}
	host, port := p, ""
	if h, pt, err := net.SplitHostPort(p); err == nil {
		host, port = h, pt
	}
	if port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			return errors.New("bad port")
		}
	}
	if isLocalHost(host) {
		return nil
	}
	if net.ParseIP(host) != nil {
		return errors.New("use a host name, not an IP address")
	}
	if host != strings.ToLower(host) || !hostRe.MatchString(host) {
		return errors.New("not a host name")
	}
	if !strings.Contains(strings.TrimPrefix(host, "*."), ".") {
		return errors.New(`too broad: name a site, like "api.example.com" or "*.example.com"`)
	}
	return nil
}

func isLocalHost(h string) bool {
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// compareVersions compares the x.y.z part of two versions
func compareVersions(a, b string) int {
	pa, pb := nums(a), nums(b)
	for i := range 3 {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func nums(v string) [3]int {
	var out [3]int
	v, _, _ = strings.Cut(v, "-")
	v, _, _ = strings.Cut(v, "+")
	for i, s := range strings.SplitN(v, ".", 3) {
		out[i], _ = strconv.Atoi(s)
	}
	return out
}
