package uploads

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestNewEmptiesLeftovers(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "uploads")
	os.MkdirAll(dir, 0o700)
	os.WriteFile(filepath.Join(dir, "old"), []byte("x"), 0o600)
	if _, err := New(dir); err != nil {
		t.Fatal(err)
	}
	if left, _ := os.ReadDir(dir); len(left) != 0 {
		t.Fatalf("leftovers kept: %v", left)
	}
}

func TestPostThenGetThenDrop(t *testing.T) {
	s, err := New(filepath.Join(t.TempDir(), "up"))
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler("/wz-upload/")
	data := pngBytes(t)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/wz-upload/?name=..%2F..%2Fshot.png", bytes.NewReader(data)))
	if rec.Code != 200 {
		t.Fatalf("post: %d %s", rec.Code, rec.Body)
	}
	var it Item
	if err := json.Unmarshal(rec.Body.Bytes(), &it); err != nil {
		t.Fatal(err)
	}
	if it.Name != "shot.png" || it.Kind != "image" || it.Mime != "image/png" || it.Size != int64(len(data)) {
		t.Fatalf("item: %+v", it)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/wz-upload/"+it.Token, nil))
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), data) {
		t.Fatalf("get: %d", rec.Code)
	}

	_, got, err := s.Read(it.Token)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("read: %v", err)
	}
	s.Drop(it.Token)
	if _, _, err := s.Read(it.Token); err != ErrNotFound {
		t.Fatalf("after drop: %v", err)
	}
	if left, _ := os.ReadDir(s.dir); len(left) != 0 {
		t.Fatalf("temp file kept: %v", left)
	}
}

func TestPickedFilesAreNotDeleted(t *testing.T) {
	s, _ := New(filepath.Join(t.TempDir(), "up"))
	p := filepath.Join(t.TempDir(), "report.docx")
	os.WriteFile(p, []byte("PK\x03\x04 not really a docx"), 0o600)
	it, err := s.AddPath(p)
	if err != nil {
		t.Fatal(err)
	}
	if it.Kind != "file" || !strings.Contains(it.Mime, "officedocument") {
		t.Fatalf("item: %+v", it)
	}
	s.Drop(it.Token)
	if _, err := os.Stat(p); err != nil {
		t.Fatal("the user's file was deleted")
	}
}

func TestRefusesEmptyAndUnknown(t *testing.T) {
	s, _ := New(filepath.Join(t.TempDir(), "up"))
	if _, err := s.AddReader("a.txt", bytes.NewReader(nil)); err != ErrEmpty {
		t.Fatalf("empty: %v", err)
	}
	rec := httptest.NewRecorder()
	s.Handler("/wz-upload/").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/wz-upload/nope", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown token: %d", rec.Code)
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"":                                "file",
		`C:\Users\x\a.png`:                "a.png",
		"we\x00ird:na*me.txt":             "weirdname.txt",
		strings.Repeat("я", 200) + ".pdf": strings.Repeat("я", 116) + ".pdf",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q", in, got)
		}
	}
}
