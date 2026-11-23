package avatar

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/store"
)

var jpeg = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 1, 2, 3}

type fakeFetcher struct {
	calls  atomic.Int32
	info   *types.ProfilePictureInfo
	err    error
	lastID string
}

func (f *fakeFetcher) GetProfilePicture(_ context.Context, _ types.JID, existingID string, _ bool) (*types.ProfilePictureInfo, error) {
	f.calls.Add(1)
	f.lastID = existingID
	if f.info != nil && existingID == f.info.ID {
		return nil, nil
	}
	return f.info, f.err
}

type cdn struct {
	hits atomic.Int32
	body []byte
}

func (c *cdn) RoundTrip(r *http.Request) (*http.Response, error) {
	c.hits.Add(1)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(c.body)), Header: http.Header{}, Request: r}, nil
}

type env struct {
	s       *Store
	f       *fakeFetcher
	cdn     *cdn
	online  bool
	clock   time.Time
	handler http.Handler
}

var alice = types.NewJID("491700000001", types.DefaultUserServer)

func newEnv(t *testing.T) *env {
	t.Helper()
	tmp := t.TempDir()
	db, err := store.Open(context.Background(), filepath.Join(tmp, "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := &env{f: &fakeFetcher{info: &types.ProfilePictureInfo{ID: "pic1", URL: "https://pps.whatsapp.net/v/t61/a.jpg"}}, cdn: &cdn{body: jpeg}, online: true, clock: time.Unix(1_750_000_000, 0)}
	e.s = New(filepath.Join(tmp, "avatars"), db, func() Fetcher {
		if !e.online {
			return nil
		}
		return e.f
	}, nil)
	e.s.http = &http.Client{Transport: e.cdn}
	e.s.now = func() time.Time { return e.clock }
	e.handler = e.s.Handler("/wz-avatar/")
	return e
}

func (e *env) get(path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	e.handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestFetchCacheAndRefresh(t *testing.T) {
	e := newEnv(t)
	w := e.get("/wz-avatar/" + alice.String())
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), jpeg) || w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("first fetch: %d %v", w.Code, w.Header())
	}
	// within a day: no new request to WhatsApp
	e.get("/wz-avatar/" + alice.String())
	if e.f.calls.Load() != 1 || e.cdn.hits.Load() != 1 {
		t.Fatalf("calls=%d hits=%d, want 1/1", e.f.calls.Load(), e.cdn.hits.Load())
	}
	// a day later we ask again with the known id; unchanged means no download
	e.clock = e.clock.Add(25 * time.Hour)
	if w := e.get("/wz-avatar/" + alice.String()); w.Code != 200 {
		t.Fatalf("after refresh: %d", w.Code)
	}
	if e.f.calls.Load() != 2 || e.f.lastID != "pic1" || e.cdn.hits.Load() != 1 {
		t.Errorf("refresh: calls=%d lastID=%q hits=%d", e.f.calls.Load(), e.f.lastID, e.cdn.hits.Load())
	}
	// a Picture event invalidates: new picture gets downloaded
	e.f.info = &types.ProfilePictureInfo{ID: "pic2", URL: "https://pps.whatsapp.net/v/t61/b.jpg"}
	e.cdn.body = append(append([]byte{}, jpeg...), 9)
	e.s.Invalidate(context.Background(), alice.String())
	if w := e.get("/wz-avatar/" + alice.String()); w.Code != 200 || w.Body.Len() != len(jpeg)+1 {
		t.Fatalf("after invalidate: %d len=%d", w.Code, w.Body.Len())
	}
}

func TestNoPictureAndHidden(t *testing.T) {
	for _, err := range []error{whatsmeow.ErrProfilePictureNotSet, whatsmeow.ErrProfilePictureUnauthorized} {
		e := newEnv(t)
		e.f.info, e.f.err = nil, err
		if w := e.get("/wz-avatar/" + alice.String()); w.Code != 404 {
			t.Fatalf("%v: status %d", err, w.Code)
		}
		e.get("/wz-avatar/" + alice.String())
		if e.f.calls.Load() != 1 {
			t.Errorf("%v: asked WhatsApp %d times, the answer should be cached", err, e.f.calls.Load())
		}
	}
}

func TestOfflineServesStale(t *testing.T) {
	e := newEnv(t)
	e.get("/wz-avatar/" + alice.String())
	e.online = false
	e.clock = e.clock.Add(48 * time.Hour)
	if w := e.get("/wz-avatar/" + alice.String()); w.Code != 200 {
		t.Fatalf("offline with a cached picture: %d", w.Code)
	}
	if w := e.get("/wz-avatar/" + types.NewJID("491700000002", types.DefaultUserServer).String()); w.Code != 404 {
		t.Fatalf("offline without a cached picture: %d", w.Code)
	}
}

func TestBadRequests(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/wz-avatar/", "/wz-avatar/..%2F..%2Fsettings.json", "/wz-avatar/a/b@s.whatsapp.net", "/wz-avatar/@s.whatsapp.net"} {
		if w := e.get(p); w.Code != 404 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	e.f.info.URL = "https://evil.example.com/x.jpg"
	if w := e.get("/wz-avatar/" + alice.String()); w.Code != 404 || e.cdn.hits.Load() != 0 {
		t.Errorf("fetched from a non-WhatsApp host: %d hits=%d", w.Code, e.cdn.hits.Load())
	}
}

func TestAllowedURL(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://pps.whatsapp.net/v/a.jpg":    true,
		"http://pps.whatsapp.net/v/a.jpg":     false,
		"https://whatsapp.net.evil.com/a.jpg": false,
		"https://evilwhatsapp.net/a.jpg":      false,
	} {
		if allowedURL(raw) != want {
			t.Errorf("allowedURL(%q) = %v", raw, !want)
		}
	}
}
