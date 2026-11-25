package assets

import (
	"bytes"
	"errors"
	"html"
	"maps"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	ThemesPrefix   = "/wz-themes/"
	PluginsPrefix  = "/wz-plugins/"
	MediaPrefix    = "/wz-media/"
	AvatarPrefix   = "/wz-avatar/"
	StickersPrefix = "/wz-stickers/"
	UploadsPrefix  = "/wz-upload/"
)

type Options struct {
	ThemesDir   string
	PluginsDir  string
	StickersDir string
	// Media serves /wz-media/<pk>; nil answers 404
	Media http.Handler
	// Avatars serves /wz-avatar/<jid>; nil answers 404
	Avatars http.Handler
	// Uploads takes files to send (POST /wz-upload/) and serves their previews; nil answers 404
	Uploads http.Handler
	// HTMLAttrs is added to the index page's <html> tag, so data-theme is right before any CSS
	// or script runs and a dark window doesn't flash light.
	HTMLAttrs func() map[string]string
}

// Middleware serves the /wz-* paths from the config folder and passes everything else on to the
// embedded frontend (or the Vite proxy in dev).
func Middleware(o Options) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := r.URL.Path
			switch {
			case strings.HasPrefix(p, ThemesPrefix):
				serveFile(w, r, o.ThemesDir, strings.TrimPrefix(p, ThemesPrefix), true)
			case strings.HasPrefix(p, PluginsPrefix):
				rest := strings.TrimPrefix(p, PluginsPrefix)
				id, _, _ := strings.Cut(rest, "/")
				if !ValidPluginID(id) {
					http.NotFound(w, r)
					return
				}
				serveFile(w, r, o.PluginsDir, rest, false)
			case strings.HasPrefix(p, StickersPrefix):
				serveFile(w, r, o.StickersDir, strings.TrimPrefix(p, StickersPrefix), false)
			case strings.HasPrefix(p, AvatarPrefix):
				if o.Avatars == nil {
					http.NotFound(w, r)
					return
				}
				o.Avatars.ServeHTTP(w, r)
			case strings.HasPrefix(p, UploadsPrefix):
				if o.Uploads == nil {
					http.NotFound(w, r)
					return
				}
				o.Uploads.ServeHTTP(w, r)
			case strings.HasPrefix(p, MediaPrefix):
				if o.Media == nil {
					http.NotFound(w, r)
					return
				}
				o.Media.ServeHTTP(w, r)
			case p == "/wails/custom.js":
				// the Wails runtime always probes for this optional script; answer instead of
				// leaving a 404 in the console on every start
				w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
				w.WriteHeader(http.StatusOK)
			case o.HTMLAttrs != nil && r.Method == http.MethodGet && (p == "/" || p == "/index.html"):
				serveIndex(w, r, next, o.HTMLAttrs())
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

var pluginIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// ValidPluginID is what a plugin folder (and id) may be called.
func ValidPluginID(id string) bool {
	return pluginIDRe.MatchString(id) && !strings.Contains(id, "..")
}

var errBadPath = errors.New("bad path")

var reservedWindowsNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// SafeRel validates a URL-relative path before it gets anywhere near the file system.
// os.Root does the real containment (including symlinks); this rejects the obvious stuff early
// and the Windows-specific tricks (drive letters, ADS, device names, backslashes).
func SafeRel(p string) (string, error) {
	if p == "" || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:\x00") {
		return "", errBadPath
	}
	for seg := range strings.SplitSeq(p, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", errBadPath
		}
		// Windows ignores trailing dots and spaces, "x.css." would open "x.css"
		if strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " ") {
			return "", errBadPath
		}
		stem, _, _ := strings.Cut(seg, ".")
		if reservedWindowsNames[strings.ToUpper(stem)] {
			return "", errBadPath
		}
	}
	if path.Clean(p) != p || filepath.IsAbs(p) {
		return "", errBadPath
	}
	return p, nil
}

func serveFile(w http.ResponseWriter, r *http.Request, dir, rel string, noStore bool) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel, err := SafeRel(rel)
	if err != nil || dir == "" {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()

	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() || !st.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}

	h := w.Header()
	h.Set("Content-Type", ContentType(rel))
	h.Set("X-Content-Type-Options", "nosniff")
	if noStore {
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		h.Set("Pragma", "no-cache")
		h.Set("Expires", "0")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

// Explicit types first: on Windows mime.TypeByExtension reads the registry, and some machines
// map .js to text/plain, which breaks module scripts.
var contentTypes = map[string]string{
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".json":  "application/json",
	".map":   "application/json",
	".html":  "text/html; charset=utf-8",
	".txt":   "text/plain; charset=utf-8",
	".md":    "text/markdown; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".webp":  "image/webp",
	".avif":  "image/avif",
	".ico":   "image/x-icon",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".wasm":  "application/wasm",
}

func ContentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := contentTypes[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

var htmlTagRe = regexp.MustCompile(`(?i)<html\b`)

func serveIndex(w http.ResponseWriter, r *http.Request, next http.Handler, attrs map[string]string) {
	if len(attrs) == 0 {
		next.ServeHTTP(w, r)
		return
	}
	// we need the plain body to rewrite it
	r = r.Clone(r.Context())
	r.Header.Del("Accept-Encoding")
	r.Header.Del("If-None-Match")
	r.Header.Del("If-Modified-Since")

	rec := &recorder{header: http.Header{}, status: http.StatusOK}
	next.ServeHTTP(rec, r)

	body := rec.body.Bytes()
	ct := rec.header.Get("Content-Type")
	if rec.status == http.StatusOK && (ct == "" || strings.HasPrefix(ct, "text/html")) && rec.header.Get("Content-Encoding") == "" {
		if loc := htmlTagRe.FindIndex(body); loc != nil {
			var b bytes.Buffer
			b.Write(body[:loc[1]])
			b.WriteString(renderAttrs(attrs))
			b.Write(body[loc[1]:])
			body = b.Bytes()
		}
		if ct == "" {
			rec.header.Set("Content-Type", "text/html; charset=utf-8")
		}
	}

	maps.Copy(w.Header(), rec.header)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Header().Del("ETag")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(rec.status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

func renderAttrs(attrs map[string]string) string {
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(" ")
		b.WriteString(k)
		b.WriteString(`="`)
		b.WriteString(html.EscapeString(attrs[k]))
		b.WriteString(`"`)
	}
	return b.String()
}

type recorder struct {
	header http.Header
	status int
	body   bytes.Buffer
	wrote  bool
}

func (r *recorder) Header() http.Header { return r.header }
func (r *recorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
}
func (r *recorder) Write(p []byte) (int, error) {
	r.wrote = true
	return r.body.Write(p)
}
