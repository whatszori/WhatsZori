package media

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"

	"go.mau.fi/whatsmeow"

	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

type fakeDL struct {
	data  []byte
	err   error
	calls atomic.Int32
}

func (f *fakeDL) DownloadMedia(context.Context, wa.MediaRef) ([]byte, error) {
	f.calls.Add(1)
	return f.data, f.err
}

type env struct {
	s   *Store
	db  *sql.DB
	dir string
	dl  *fakeDL
	h   http.Handler
}

func newEnv(t *testing.T) *env {
	t.Helper()
	tmp := t.TempDir()
	db, err := store.Open(context.Background(), filepath.Join(tmp, "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	dir := filepath.Join(tmp, "media")
	os.MkdirAll(dir, 0o755)
	e := &env{db: db, dir: dir, dl: &fakeDL{}}
	e.s = New(dir, db, func() Downloader { return e.dl }, nil)
	e.h = e.s.Handler("/wz-media/")
	return e
}

var jpegThumb = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0}

func (e *env) addMedia(t *testing.T, id string, m repo.MediaRow) int64 {
	t.Helper()
	ctx := context.Background()
	repo.EnsureChat(ctx, e.db, "a@s.whatsapp.net", false)
	pk, _, err := repo.InsertMessage(ctx, e.db, &repo.MessageRow{ChatJID: "a@s.whatsapp.net", MsgID: id, SenderJID: "a", TS: 1, Kind: "video"})
	if err != nil {
		t.Fatal(err)
	}
	m.MessagePK = pk
	if err := repo.UpsertMedia(ctx, e.db, m); err != nil {
		t.Fatal(err)
	}
	if m.LocalPath != "" {
		repo.SetMediaLocal(ctx, e.db, pk, m.LocalPath)
	}
	return pk
}

func (e *env) get(path string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	return w
}

func TestRange(t *testing.T) {
	e := newEnv(t)
	data := make([]byte, 1000)
	for i := range data {
		data[i] = byte(i)
	}
	rel, err := e.s.Save(data, nil, "video/mp4", "")
	if err != nil {
		t.Fatal(err)
	}
	pk := e.addMedia(t, "V", repo.MediaRow{MediaType: "video", Mime: "video/mp4", LocalPath: rel})

	w := e.get("/wz-media/"+strconv.FormatInt(pk, 10), map[string]string{"Range": "bytes=100-199"})
	if w.Code != http.StatusPartialContent {
		t.Fatalf("status %d, want 206", w.Code)
	}
	body, _ := io.ReadAll(w.Body)
	if len(body) != 100 || body[0] != 100 || body[99] != 199 {
		t.Errorf("wrong range body: len=%d", len(body))
	}
	if w.Header().Get("Content-Type") != "video/mp4" || w.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("headers: %v", w.Header())
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Security-Policy") == "" {
		t.Errorf("missing safety headers")
	}
	if e.dl.calls.Load() != 0 {
		t.Error("downloaded a local file")
	}
}

func TestTraversalAndBadPaths(t *testing.T) {
	e := newEnv(t)
	secret := filepath.Join(filepath.Dir(e.dir), "secret.txt")
	os.WriteFile(secret, []byte("nope"), 0o644)
	bad := []string{"../secret.txt", "..\\secret.txt", "/etc/passwd", "C:/Windows/win.ini", "a/../../secret.txt", "CON"}
	for i, rel := range bad {
		pk := e.addMedia(t, "B"+strconv.Itoa(i), repo.MediaRow{MediaType: "document", LocalPath: rel})
		// make the on-demand download fail so nothing replaces the bad path
		e.dl.err = whatsmeow.ErrMediaDownloadFailedWith404
		w := e.get("/wz-media/"+strconv.FormatInt(pk, 10), nil)
		if w.Code == http.StatusOK || w.Code == http.StatusPartialContent {
			t.Errorf("local_path %q served: %d %q", rel, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{"/wz-media/../secret.txt", "/wz-media/abc", "/wz-media/-1", "/wz-media/1/../../x", "/wz-media/"} {
		if w := e.get(p, nil); w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", p, w.Code)
		}
	}
}

func TestDownloadOnDemand(t *testing.T) {
	e := newEnv(t)
	e.dl.data = []byte("OggS voice data")
	pk := e.addMedia(t, "A", repo.MediaRow{MediaType: "audio", Mime: "audio/ogg; codecs=opus", DirectPath: "/v/x", MediaKey: []byte{1}})

	w := e.get("/wz-media/"+strconv.FormatInt(pk, 10), nil)
	if w.Code != http.StatusOK || w.Body.String() != "OggS voice data" {
		t.Fatalf("on-demand download: %d %q", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "audio/ogg; codecs=opus" {
		t.Errorf("content type %q", ct)
	}
	row, _ := repo.GetMedia(context.Background(), e.db, pk)
	if row.State != repo.MediaLocal || filepath.Ext(row.LocalPath) != ".ogg" || len(row.LocalPath) < 66 {
		t.Errorf("not stored with a hashed name: %+v", row)
	}
	e.get("/wz-media/"+strconv.FormatInt(pk, 10), nil)
	if e.dl.calls.Load() != 1 {
		t.Errorf("downloaded %d times", e.dl.calls.Load())
	}
}

func TestExpiredFallsBackToThumbnail(t *testing.T) {
	e := newEnv(t)
	e.dl.err = whatsmeow.ErrMediaDownloadFailedWith410
	pk := e.addMedia(t, "I", repo.MediaRow{MediaType: "image", Mime: "image/jpeg", DirectPath: "/v/x", MediaKey: []byte{1}, Thumbnail: jpegThumb})
	path := "/wz-media/" + strconv.FormatInt(pk, 10)

	w := e.get(path, nil)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/jpeg" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("thumbnail fallback: %d %v", w.Code, w.Header())
	}
	row, _ := repo.GetMedia(context.Background(), e.db, pk)
	if row.State != repo.MediaExpired {
		t.Errorf("state %q, want expired", row.State)
	}
	// expired isn't retried
	e.get(path, nil)
	if e.dl.calls.Load() != 1 {
		t.Errorf("retried an expired download")
	}
	if w := e.get(path+"?thumb=1", nil); w.Code != http.StatusOK || w.Header().Get("Cache-Control") == "no-store" {
		t.Errorf("thumb=1: %d %v", w.Code, w.Header())
	}

	video := e.addMedia(t, "K", repo.MediaRow{MediaType: "video", Mime: "video/mp4", DirectPath: "/v/z", MediaKey: []byte{1}})
	calls := e.dl.calls.Load()
	if w := e.get("/wz-media/"+strconv.FormatInt(video, 10)+"?thumb=1", nil); w.Code != http.StatusNotFound || e.dl.calls.Load() != calls {
		t.Errorf("thumb=1 without a thumbnail: %d, downloads %d -> %d", w.Code, calls, e.dl.calls.Load())
	}

	noThumb := e.addMedia(t, "J", repo.MediaRow{MediaType: "image", Mime: "image/jpeg", DirectPath: "/v/y", MediaKey: []byte{1}})
	if w := e.get("/wz-media/"+strconv.FormatInt(noThumb, 10), nil); w.Code != http.StatusGone {
		t.Errorf("expired without thumbnail: %d, want 410", w.Code)
	}
}

func TestDangerousTypesAreDownloads(t *testing.T) {
	e := newEnv(t)
	rel, _ := e.s.Save([]byte("<script>alert(1)</script>"), nil, "text/html", "x.html")
	pk := e.addMedia(t, "H", repo.MediaRow{MediaType: "document", Mime: "text/html", FileName: "x.html", LocalPath: rel})
	w := e.get("/wz-media/"+strconv.FormatInt(pk, 10), nil)
	if ct := w.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("html served as %q", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); cd == "" {
		t.Error("html not served as an attachment")
	}
}

func TestRemove(t *testing.T) {
	e := newEnv(t)
	rel, _ := e.s.Save([]byte("x"), nil, "image/png", "")
	e.s.Remove(rel)
	if _, err := os.Stat(filepath.Join(e.dir, rel)); !os.IsNotExist(err) {
		t.Errorf("file still there: %v", err)
	}
	outside := filepath.Join(filepath.Dir(e.dir), "keep.txt")
	os.WriteFile(outside, []byte("x"), 0o644)
	e.s.Remove("../keep.txt")
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("Remove escaped the media folder")
	}
}
