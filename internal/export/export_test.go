package export

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/media"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

const chat = "491700000001@s.whatsapp.net"
const me = "10000000001@s.whatsapp.net"

type env struct {
	job *Job
	dir string
}

func setup(t *testing.T) *env {
	t.Helper()
	ctx := context.Background()
	tmp := t.TempDir()
	db, err := store.Open(ctx, filepath.Join(tmp, "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mediaDir := filepath.Join(tmp, "media")
	ms := media.New(mediaDir, db, nil, nil)

	repo.EnsureChat(ctx, db, chat, false)
	repo.SetContactName(ctx, db, chat, "Alan", "Alan", 0)
	base := time.Date(2026, 11, 20, 10, 0, 0, 0, time.Local).UnixMilli()
	add := func(id string, from string, minutes int, kind, body string, file []byte, mime, name string) int64 {
		row := &repo.MessageRow{ChatJID: chat, MsgID: id, SenderJID: from, FromMe: from == me, TS: base + int64(minutes)*60_000,
			Kind: kind, Body: body, Raw: []byte{1}}
		pk, _, err := repo.InsertMessage(ctx, db, row)
		if err != nil {
			t.Fatal(err)
		}
		if file != nil {
			rel, err := ms.Save(file, nil, mime, name)
			if err != nil {
				t.Fatal(err)
			}
			repo.UpsertMedia(ctx, db, repo.MediaRow{MessagePK: pk, MediaType: "image", Mime: mime, FileName: name, Size: int64(len(file))})
			repo.SetMediaLocal(ctx, db, pk, rel)
		}
		return pk
	}
	add("T1", chat, 0, repo.KindText, `hi <script>alert("x")</script>`, nil, "", "")
	add("IMG", chat, 1, repo.KindImage, "a photo", []byte("\xff\xd8jpegdata"), "image/jpeg", "")
	add("DOC", me, 2, repo.KindDocument, "", []byte(strings.Repeat("x", 3000)), "application/pdf", `..\..\report.pdf`)
	add("STK", chat, 3, repo.KindSticker, "", []byte("RIFFwebp"), "image/webp", "")
	edited := add("ED", me, 4, repo.KindText, "final", nil, "", "")
	repo.InsertEdit(ctx, db, edited, repo.EditRow{Version: 0, Body: "first", EditedAt: base})
	repo.InsertEdit(ctx, db, edited, repo.EditRow{Version: 1, Body: "final", EditedAt: base + 1})
	repo.UpdateBody(ctx, db, edited, "final", 1, base+1)
	del := add("DEL", chat, 5, repo.KindText, "oops", nil, "", "")
	repo.MarkDeleted(ctx, db, del, base+6*60_000, chat, "sender")
	add("LATE", chat, 60*24*3, repo.KindText, "three days later", nil, "", "")

	out := filepath.Join(tmp, "out")
	os.MkdirAll(out, 0o755)
	return &env{dir: out, job: &Job{
		DB: db, View: repo.View{Me: me}, Media: ms, MediaDir: mediaDir, Dir: out,
		Opts: domain.ExportOptions{JID: chat, Media: []string{Photo, File}, Format: "html"},
		Now:  func() time.Time { return time.Date(2026, 11, 23, 12, 0, 0, 0, time.Local) },
	}}
}

func TestHTML(t *testing.T) {
	e := setup(t)
	folder, err := e.job.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	html, _ := os.ReadFile(filepath.Join(folder, "chat.html"))
	s := string(html)
	if strings.Contains(s, `<script>alert`) {
		t.Fatal("message text not escaped")
	}
	for _, want := range []string{"&lt;script&gt;", `src="media/IMG-20261120-WA0001.jpg"`, "report.pdf", "Deleted by Alan",
		"Edited · 2 versions", "sticker not included: not selected", "three days later"} {
		if !strings.Contains(s, want) {
			t.Errorf("html is missing %q", want)
		}
	}
	if _, err := os.Stat(filepath.Join(folder, "media", "report.pdf")); err != nil {
		t.Errorf("document not copied under its own (sanitized) name: %v", err)
	}
	if !strings.HasPrefix(filepath.Base(folder), "WhatsZori - Alan - 2026-11-23") {
		t.Errorf("folder name %q", filepath.Base(folder))
	}
}

func TestJSONWithLimitsAndRange(t *testing.T) {
	e := setup(t)
	e.job.Opts.Format = "json"
	e.job.Opts.MaxBytes = 1000
	e.job.Opts.To = time.Date(2026, 11, 21, 0, 0, 0, 0, time.Local).UnixMilli()
	folder, err := e.job.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var c Chat
	data, _ := os.ReadFile(filepath.Join(folder, "chat.json"))
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Messages) != 6 {
		t.Fatalf("got %d messages, want 6 (the late one is outside the range)", len(c.Messages))
	}
	byID := map[string]Message{}
	for _, m := range c.Messages {
		byID[m.ID] = m
	}
	if byID["IMG"].Media == nil {
		t.Error("small photo missing")
	}
	if byID["DOC"].Media != nil || byID["DOC"].MediaOmitted != "larger than the size limit" {
		t.Errorf("big document: %+v", byID["DOC"])
	}
	if len(byID["ED"].Edits) != 2 || byID["DEL"].Deleted == nil || byID["DEL"].Text != "oops" {
		t.Errorf("edits or kept deletes lost: %+v %+v", byID["ED"], byID["DEL"])
	}
}

func TestTXT(t *testing.T) {
	e := setup(t)
	e.job.Opts.Format = "txt"
	folder, err := e.job.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(folder, "chat.txt"))
	s := string(data)
	for _, want := range []string{"20.11.2026, 10:00 - Alan: hi", "IMG-20261120-WA0001.jpg (file attached)", "<Media omitted>", "<This message was edited>"} {
		if !strings.Contains(s, want) {
			t.Errorf("txt is missing %q:\n%s", want, s)
		}
	}
}

func TestBadFormat(t *testing.T) {
	e := setup(t)
	e.job.Opts.Format = "exe"
	if _, err := e.job.Run(context.Background()); err != ErrFormat {
		t.Errorf("err = %v", err)
	}
}
