// Package export writes a chat to a folder: chat.html, chat.json or chat.txt, plus the chosen
// media in a media/ subfolder next to it.
package export

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Media categories the user can tick.
const (
	Photo   = "photo"
	Video   = "video"
	Voice   = "voice"
	Round   = "round"
	Sticker = "sticker"
	Gif     = "gif"
	File    = "file"
)

func category(kind string) string {
	switch kind {
	case repo.KindImage:
		return Photo
	case repo.KindVideo:
		return Video
	case repo.KindAudio, repo.KindVoice:
		return Voice
	case repo.KindRound:
		return Round
	case repo.KindSticker:
		return Sticker
	case repo.KindGif:
		return Gif
	case repo.KindDocument:
		return File
	}
	return ""
}

// Media is the part of the media store an export needs.
type Media interface {
	Ensure(ctx context.Context, pk int64) (repo.MediaRow, error)
}

type Progress func(phase string, done, total int)

type Job struct {
	DB       *sql.DB
	View     repo.View
	Media    Media
	MediaDir string
	Opts     domain.ExportOptions
	// Dir is the folder the user picked; the export goes into a new subfolder of it
	Dir      string
	Progress Progress
	Now      func() time.Time
}

// Message is one exported message, shared by all three formats.
type Message struct {
	ID        string     `json:"id"`
	Time      time.Time  `json:"time"`
	Sender    string     `json:"sender"`
	SenderJID string     `json:"senderJid"`
	FromMe    bool       `json:"fromMe"`
	Kind      string     `json:"kind"`
	Text      string     `json:"text,omitempty"`
	Media     *MediaFile `json:"media,omitempty"`
	// why the media isn't in the export: not selected, too large, expired, not downloaded
	MediaOmitted string     `json:"mediaOmitted,omitempty"`
	ReplyTo      *Reply     `json:"replyTo,omitempty"`
	Deleted      *Deleted   `json:"deleted,omitempty"`
	Edits        []Edit     `json:"edits,omitempty"`
	Reactions    []Reaction `json:"reactions,omitempty"`
}

type MediaFile struct {
	Path     string `json:"path"`
	Mime     string `json:"mime,omitempty"`
	Size     int64  `json:"size"`
	FileName string `json:"fileName,omitempty"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
	Duration int    `json:"duration,omitempty"`
}

type Reply struct {
	ID     string `json:"id"`
	Sender string `json:"sender"`
	Text   string `json:"text"`
}

type Deleted struct {
	By string    `json:"by"`
	At time.Time `json:"at"`
}

type Edit struct {
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

type Chat struct {
	JID        string    `json:"jid"`
	Name       string    `json:"name"`
	IsGroup    bool      `json:"isGroup"`
	ExportedAt time.Time `json:"exportedAt"`
	From       time.Time `json:"from,omitzero"`
	To         time.Time `json:"to,omitzero"`
	Messages   []Message `json:"messages"`
}

var ErrFormat = errors.New("unknown export format")

// Run writes the export and returns the folder it created.
func (j *Job) Run(ctx context.Context) (string, error) {
	if j.Now == nil {
		j.Now = time.Now
	}
	if j.Progress == nil {
		j.Progress = func(string, int, int) {}
	}
	o := j.Opts
	switch o.Format {
	case "html", "json", "txt":
	default:
		return "", ErrFormat
	}
	row, err := repo.GetChat(ctx, j.DB, o.JID)
	if err != nil {
		return "", err
	}
	chatDTO, err := j.View.Chat(ctx, j.DB, row)
	if err != nil {
		return "", err
	}

	j.Progress("collecting", 0, 0)
	var rows []repo.MessageRow
	var afterTS, afterPK int64 = -1 << 62, 0
	for {
		page, err := repo.MessagesBetween(ctx, j.DB, o.JID, o.From, o.To, afterTS, afterPK, 1000)
		if err != nil {
			return "", err
		}
		rows = append(rows, page...)
		if len(page) < 1000 {
			break
		}
		last := page[len(page)-1]
		afterTS, afterPK = last.TS, last.PK
		if err := ctx.Err(); err != nil {
			return "", err
		}
	}

	out := filepath.Join(j.Dir, folderName(chatDTO.Name, j.Now()))
	if err := os.MkdirAll(out, 0o755); err != nil {
		return "", err
	}
	chat := Chat{JID: o.JID, Name: chatDTO.Name, IsGroup: row.IsGroup, ExportedAt: j.Now(), Messages: make([]Message, 0, len(rows))}
	if o.From > 0 {
		chat.From = time.UnixMilli(o.From)
	}
	if o.To > 0 {
		chat.To = time.UnixMilli(o.To)
	}

	want := map[string]bool{}
	for _, m := range o.Media {
		want[m] = true
	}
	var withMedia int
	for _, r := range rows {
		if want[category(r.Kind)] {
			withMedia++
		}
	}

	done := 0
	names := map[string]bool{}
	for i := 0; i < len(rows); i += 200 {
		part := rows[i:min(i+200, len(rows))]
		dtos, err := j.View.Messages(ctx, j.DB, part)
		if err != nil {
			return "", err
		}
		for k, r := range part {
			if err := ctx.Err(); err != nil {
				return "", err
			}
			m := j.message(ctx, r, dtos[k])
			if r.Kind != repo.KindText && category(r.Kind) != "" && !(r.IsDeleted && r.Raw == nil) {
				switch {
				case !want[category(r.Kind)]:
					m.MediaOmitted = "not selected"
				default:
					mf, why := j.copyMedia(ctx, r, out, names)
					m.Media, m.MediaOmitted = mf, why
					done++
					j.Progress("media", done, withMedia)
				}
			}
			chat.Messages = append(chat.Messages, m)
		}
	}

	j.Progress("writing", done, withMedia)
	var werr error
	switch o.Format {
	case "html":
		werr = writeHTML(filepath.Join(out, "chat.html"), chat)
	case "json":
		werr = writeJSON(filepath.Join(out, "chat.json"), chat)
	case "txt":
		werr = writeTXT(filepath.Join(out, "chat.txt"), chat)
	}
	if werr != nil {
		return "", werr
	}
	return out, nil
}

func (j *Job) message(ctx context.Context, r repo.MessageRow, d domain.Message) Message {
	m := Message{
		ID: r.MsgID, Time: time.UnixMilli(r.TS), Sender: d.SenderName, SenderJID: r.SenderJID, FromMe: r.FromMe,
		Kind: r.Kind, Text: r.Body,
	}
	if d.ReplyTo != nil {
		m.ReplyTo = &Reply{ID: r.QuotedID, Sender: d.ReplyTo.SenderName, Text: d.ReplyTo.Text}
	}
	if d.Deleted != nil {
		m.Deleted = &Deleted{By: d.Deleted.ByName, At: time.UnixMilli(d.Deleted.At)}
	}
	if r.EditCount > 0 {
		if edits, err := repo.Edits(ctx, j.DB, r.PK); err == nil {
			for _, e := range edits {
				m.Edits = append(m.Edits, Edit{Text: e.Body, At: time.UnixMilli(e.EditedAt)})
			}
		}
	}
	for _, re := range d.Reactions {
		m.Reactions = append(m.Reactions, Reaction{Emoji: re.Emoji, Count: re.Count})
	}
	return m
}

func (j *Job) copyMedia(ctx context.Context, r repo.MessageRow, out string, names map[string]bool) (*MediaFile, string) {
	row, err := repo.GetMedia(ctx, j.DB, r.PK)
	if err != nil {
		return nil, "no file"
	}
	if j.Opts.MaxBytes > 0 && row.Size > j.Opts.MaxBytes {
		return nil, "larger than the size limit"
	}
	row, err = j.Media.Ensure(ctx, r.PK)
	if err != nil {
		if strings.Contains(err.Error(), "no longer") {
			return nil, "no longer on WhatsApp's servers"
		}
		return nil, "not downloaded"
	}
	rel, err := assets.SafeRel(row.LocalPath)
	if err != nil {
		return nil, "no file"
	}
	st, err := os.Stat(filepath.Join(j.MediaDir, filepath.FromSlash(rel)))
	if err != nil {
		return nil, "no file"
	}
	if j.Opts.MaxBytes > 0 && st.Size() > j.Opts.MaxBytes {
		return nil, "larger than the size limit"
	}
	name := exportName(r, row, rel, names)
	if err := copyFile(filepath.Join(j.MediaDir, filepath.FromSlash(rel)), filepath.Join(out, "media", name)); err != nil {
		return nil, "couldn't copy"
	}
	return &MediaFile{Path: "media/" + name, Mime: row.Mime, Size: st.Size(), FileName: row.FileName,
		Width: row.Width, Height: row.Height, Duration: row.Duration}, ""
}

var prefixes = map[string]string{
	repo.KindImage: "IMG", repo.KindVideo: "VID", repo.KindRound: "PTV", repo.KindGif: "GIF",
	repo.KindAudio: "AUD", repo.KindVoice: "PTT", repo.KindSticker: "STK", repo.KindDocument: "DOC",
}

// exportName is WhatsApp's own export naming (IMG-20261123-WA0001.jpg); documents keep their name.
func exportName(r repo.MessageRow, row repo.MediaRow, rel string, used map[string]bool) string {
	ext := path.Ext(rel)
	var base string
	if row.FileName != "" {
		base = strings.TrimSuffix(SafeFileName(row.FileName), path.Ext(row.FileName))
		if e := path.Ext(row.FileName); e != "" {
			ext = e
		}
	} else {
		base = fmt.Sprintf("%s-%s-WA%04d", prefixes[r.Kind], time.UnixMilli(r.TS).Format("20060102"), len(used)+1)
	}
	name := base + ext
	for i := 2; used[strings.ToLower(name)]; i++ {
		name = fmt.Sprintf("%s (%d)%s", base, i, ext)
	}
	used[strings.ToLower(name)] = true
	return name
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// SafeFileName strips paths and characters Windows refuses from a name that came from a sender.
func SafeFileName(name string) string {
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
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	return name
}

func folderName(chat string, now time.Time) string {
	return SafeFileName(fmt.Sprintf("WhatsZori - %s - %s", chat, now.Format("2006-01-02 15.04")))
}
