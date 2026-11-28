package export

import (
	"bufio"
	"encoding/json"
	"fmt"
	"html/template"
	"os"
	"path"
	"strings"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/settings"
)

func writeJSON(file string, chat Chat) error {
	data, err := json.MarshalIndent(chat, "", "  ")
	if err != nil {
		return err
	}
	return settings.WriteFileAtomic(file, data)
}

// TXT follows WhatsApp's own "Export chat" text, so tools that read those files read ours too.
func writeTXT(file string, chat Chat) error {
	f, err := os.Create(file)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, m := range chat.Messages {
		fmt.Fprintf(w, "%s - %s: ", m.Time.Format("02.01.2006, 15:04"), m.Sender)
		var parts []string
		switch {
		case m.Deleted != nil && m.Text == "" && m.Media == nil:
			parts = append(parts, "<This message was deleted>")
		case m.Media != nil:
			parts = append(parts, path.Base(m.Media.Path)+" (file attached)")
		case m.MediaOmitted != "":
			parts = append(parts, "<Media omitted>")
		}
		if m.Text != "" {
			parts = append(parts, m.Text)
		}
		parts = append(parts, extras(m)...)
		line := strings.Join(parts, "\n")
		if m.Edits != nil {
			line += " <This message was edited>"
		}
		if m.Deleted != nil && (m.Text != "" || m.Media != nil) {
			line += " <deleted by " + m.Deleted.By + ", kept by WhatsZori>"
		}
		fmt.Fprintln(w, line)
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// extras are the text lines for what isn't text, the way WhatsApp's own export writes them.
func extras(m Message) []string {
	var out []string
	if l := m.Location; l != nil {
		s := fmt.Sprintf("location: https://maps.google.com/?q=%.6f,%.6f", l.Lat, l.Lon)
		if l.Live {
			s = "live " + s
		}
		if l.Name != "" {
			s = l.Name + " " + s
		}
		out = append(out, s)
	}
	for _, c := range m.Contacts {
		s := "Contact: " + c.Name
		for _, p := range c.Phones {
			s += ", " + p.Number
		}
		out = append(out, s)
	}
	if e := m.Event; e != nil {
		s := "EVENT: " + e.Name + "\n" + time.UnixMilli(e.Start).Format("02.01.2006, 15:04")
		if e.Place != "" {
			s += "\n" + e.Place
		}
		if e.Description != "" {
			s += "\n" + e.Description
		}
		if e.Canceled {
			s += "\n(canceled)"
		}
		out = append(out, s)
	}
	if p := m.Poll; p != nil {
		s := "POLL:\n" + p.Name
		for _, o := range p.Options {
			s += fmt.Sprintf("\nOPTION: %s (%d %s)", o.Name, o.Votes, plural(o.Votes, "vote"))
		}
		out = append(out, s)
	}
	if b := m.Business; b != nil {
		for _, btn := range b.Buttons {
			s := "[" + btn.Text + "]"
			if btn.URL != "" {
				s += " " + btn.URL
			}
			out = append(out, s)
		}
	}
	return out
}

func plural(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}

// albums marks runs of photos and videos one person sent together (each within a minute of
// the last, a caption only on the last), the way the app groups them.
func albums(ms []Message) {
	ok := func(m Message) bool {
		return m.Media != nil && (m.Kind == "image" || m.Kind == "video") && m.Deleted == nil && m.ReplyTo == nil && m.Business == nil
	}
	for i := 0; i < len(ms); {
		j := i
		for j+1 < len(ms) && ok(ms[j]) && ms[j].Text == "" && ok(ms[j+1]) && ms[j+1].SenderJID == ms[i].SenderJID &&
			ms[j+1].Time.Sub(ms[j].Time) <= time.Minute && ms[j+1].Time.YearDay() == ms[j].Time.YearDay() {
			j++
		}
		if j > i {
			for k := i; k <= j; k++ {
				ms[k].inAlbum = true
			}
			ms[i].albumStart, ms[j].albumEnd = true, true
		}
		i = j + 1
	}
}

type htmlDay struct {
	Label    string
	Messages []Message
}

type htmlData struct {
	Chat Chat
	Days []htmlDay
}

func writeHTML(file string, chat Chat) error {
	albums(chat.Messages)
	var days []htmlDay
	for _, m := range chat.Messages {
		label := m.Time.Format("Monday, 2 January 2006")
		if len(days) == 0 || days[len(days)-1].Label != label {
			days = append(days, htmlDay{Label: label})
		}
		days[len(days)-1].Messages = append(days[len(days)-1].Messages, m)
	}
	f, err := os.Create(file)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	if err := page.Execute(w, htmlData{Chat: chat, Days: days}); err != nil {
		f.Close()
		return err
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func isImage(m Message) bool {
	return m.Media != nil && (m.Kind == "image" || m.Kind == "sticker")
}

var page = template.Must(template.New("chat").Funcs(template.FuncMap{
	"clock":   func(t time.Time) string { return t.Format("15:04") },
	"full":    func(t time.Time) string { return t.Format("2 Jan 2006, 15:04") },
	"isImage": isImage,
	"isVideo": func(m Message) bool {
		return m.Media != nil && (m.Kind == "video" || m.Kind == "round" || m.Kind == "gif")
	},
	"isAudio": func(m Message) bool { return m.Media != nil && (m.Kind == "voice" || m.Kind == "audio") },
	"isFile":  func(m Message) bool { return m.Media != nil && m.Kind == "document" },
	"size": func(n int64) string {
		switch {
		case n >= 1<<20:
			return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
		case n >= 1<<10:
			return fmt.Sprintf("%d KB", n>>10)
		}
		return fmt.Sprintf("%d B", n)
	},
	"base": path.Base,
	"lines": func(s string) []string {
		return strings.Split(s, "\n")
	},
	"count": func(c Chat) int { return len(c.Messages) },
	"rich":  rich,
	// the map picture a phone attached to a place; only pictures pass
	"dataURL": func(s string) template.URL {
		if strings.HasPrefix(s, "data:image/") {
			return template.URL(s)
		}
		return ""
	},
	"when":    func(ms int64) string { return time.UnixMilli(ms).Format("Monday, 2 January 2006, 15:04") },
	"clockMS": func(ms int64) string { return time.UnixMilli(ms).Format("15:04") },
	"coord":   func(f float64) string { return fmt.Sprintf("%.5f", f) },
	"pct": func(n, total int) int {
		if total == 0 {
			return 0
		}
		return n * 100 / total
	},
	"votes": func(p *domain.PollInfo) int {
		n := 0
		for _, o := range p.Options {
			n = max(n, o.Votes)
		}
		return n
	},
	"inAlbum":    func(m Message) bool { return m.inAlbum },
	"albumStart": func(m Message) bool { return m.albumStart },
	"albumEnd":   func(m Message) bool { return m.albumEnd },
}).Parse(pageTemplate))

// Same look as the app: calm greys, slate-blue outgoing bubbles, light and dark from the system.
const pageTemplate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WhatsZori">
<title>{{.Chat.Name}} · WhatsZori export</title>
<style>
:root {
  --bg: #e9e9eb; --panel: #ffffff; --in: #ffffff; --out: #dfe7f3; --text: #1b1b1f; --muted: #6b6b73;
  --accent: #3d6fb4; --border: #dcdce0; --deleted: #b23b3b; --quote: rgb(61 111 180 / 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121214; --panel: #1b1b1e; --in: #222226; --out: #2a3648; --text: #ececef; --muted: #9a9aa3;
    --accent: #7fa6dd; --border: #2e2e33; --deleted: #e07a7a; --quote: rgb(127 166 221 / 0.12);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif; }
header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px;
  padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--border); }
header h1 { margin: 0; font-size: 16px; font-weight: 600; }
header p { margin: 0; color: var(--muted); font-size: 12px; }
.logo { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: #fff;
  display: grid; place-items: center; font-weight: 700; }
main { max-width: 860px; margin: 0 auto; padding: 16px 20px 40px; }
.day { display: flex; justify-content: center; margin: 18px 0 10px; }
.day span { padding: 3px 10px; border-radius: 999px; background: var(--panel); color: var(--muted);
  font-size: 12px; border: 1px solid var(--border); }
.msg { display: flex; margin: 3px 0; }
.msg.out { justify-content: flex-end; }
.bubble { max-width: min(560px, 82%); padding: 6px 10px 5px; border-radius: 12px; background: var(--in);
  border: 1px solid var(--border); overflow-wrap: anywhere; }
.out .bubble { background: var(--out); border-color: transparent; }
.bubble.deleted { border: 1px dashed var(--deleted); }
.sender { color: var(--accent); font-weight: 600; font-size: 12.5px; margin-bottom: 2px; }
.text { white-space: pre-wrap; margin: 0; }
.meta { display: flex; justify-content: flex-end; gap: 6px; margin-top: 2px; color: var(--muted); font-size: 11px; }
.quote { margin: 2px 0 5px; padding: 3px 8px; border-left: 2px solid var(--accent); border-radius: 4px;
  background: var(--quote); font-size: 12.5px; }
.quote b { color: var(--accent); font-weight: 600; display: block; }
.media img, .media video { display: block; max-width: 100%; max-height: 420px; border-radius: 8px; margin: 2px 0 4px; }
.sticker img { max-width: 160px; background: none; }
.round video { width: 220px; height: 220px; object-fit: cover; border-radius: 50%; }
.media audio { width: 280px; max-width: 100%; margin: 4px 0; }
.file { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: inherit; text-decoration: none; }
.file .icon { width: 36px; height: 36px; border-radius: 8px; background: var(--quote); color: var(--accent);
  display: grid; place-items: center; font-size: 11px; font-weight: 700; }
.file:hover .name { text-decoration: underline; }
.omitted { color: var(--muted); font-style: italic; font-size: 12.5px; }
.note { color: var(--deleted); font-size: 11.5px; margin-top: 3px; }
.reactions { display: flex; gap: 4px; margin-top: 4px; }
.reactions span { padding: 0 6px; border-radius: 999px; background: var(--panel); border: 1px solid var(--border); font-size: 12px; }
details { margin-top: 4px; font-size: 12px; color: var(--muted); }
details ol { margin: 4px 0 0; padding-left: 18px; }
footer { text-align: center; color: var(--muted); font-size: 12px; padding: 20px; }
.text span { white-space: pre-wrap; }
.text blockquote { margin: 2px 0; padding: 1px 0 1px 10px; border-left: 3px solid var(--border); color: var(--muted); }
.text ul, .text ol { margin: 2px 0; padding-left: 20px; }
.text pre, .text code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 0.9em; }
.text code { padding: 0 4px; border-radius: 4px; background: var(--quote); }
.text pre { margin: 4px 0; padding: 6px 8px; border-radius: 6px; background: var(--quote); overflow-x: auto; }
.text a { color: var(--accent); }
.card { margin: 2px 0 4px; padding: 8px 10px; border-radius: 8px; background: var(--quote); }
.card b { display: block; }
.card small, .card .sub { color: var(--muted); font-size: 12px; }
.card img { display: block; width: 100%; max-height: 160px; object-fit: cover; border-radius: 6px; margin-bottom: 6px; }
.card .links a { color: var(--accent); font-size: 12px; margin-right: 10px; }
.opt { margin: 5px 0; font-size: 13px; }
.opt .bar { height: 4px; border-radius: 2px; background: var(--border); margin-top: 2px; }
.opt .bar i { display: block; height: 100%; border-radius: 2px; background: var(--accent); }
.buttons { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.buttons span, .buttons a { padding: 5px 8px; border-radius: 6px; background: var(--quote); color: var(--accent); text-align: center; font-size: 13px; text-decoration: none; }
.album { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; width: 320px; max-width: 100%; border-radius: 8px; overflow: hidden; margin: 2px 0 4px; }
.album a { display: block; aspect-ratio: 1; background: var(--quote); }
.album img, .album video { width: 100%; height: 100%; object-fit: cover; display: block; }
.timer { font-size: 11px; }
</style>
</head>
<body>
<header>
  <div class="logo">Z</div>
  <div>
    <h1>{{.Chat.Name}}</h1>
    <p>{{count .Chat}} messages · exported {{full .Chat.ExportedAt}}{{if not .Chat.From.IsZero}} · from {{full .Chat.From}}{{end}}{{if not .Chat.To.IsZero}} · to {{full .Chat.To}}{{end}}</p>
  </div>
</header>
<main>
{{range .Days}}
  <div class="day"><span>{{.Label}}</span></div>
  {{range .Messages}}
  {{if inAlbum .}}
  {{if albumStart .}}<div class="msg {{if .FromMe}}out{{else}}in{{end}}"><div class="bubble">{{if and $.Chat.IsGroup (not .FromMe)}}<div class="sender">{{.Sender}}</div>{{end}}<div class="album">{{end}}
  <a href="{{.Media.Path}}" id="m-{{.ID}}">{{if isImage .}}<img src="{{.Media.Path}}" alt="" loading="lazy">{{else}}<video src="{{.Media.Path}}" preload="metadata"></video>{{end}}</a>
  {{if albumEnd .}}</div>{{if .Text}}<div class="text">{{rich .Text}}</div>{{end}}<div class="meta"><span title="{{full .Time}}">{{clock .Time}}</span></div></div></div>{{end}}
  {{else}}
  <div class="msg {{if .FromMe}}out{{else}}in{{end}}" id="m-{{.ID}}">
    <div class="bubble{{if .Deleted}} deleted{{end}}">
      {{if and $.Chat.IsGroup (not .FromMe)}}<div class="sender">{{.Sender}}</div>{{end}}
      {{with .ReplyTo}}<a class="quote" href="#m-{{.ID}}" style="display:block;color:inherit;text-decoration:none"><b>{{.Sender}}</b>{{.Text}}</a>{{end}}
      {{if isImage .}}<div class="media{{if eq .Kind "sticker"}} sticker{{end}}"><a href="{{.Media.Path}}"><img src="{{.Media.Path}}" alt="" loading="lazy"></a></div>{{end}}
      {{if isVideo .}}<div class="media{{if eq .Kind "round"}} round{{end}}"><video src="{{.Media.Path}}" controls preload="metadata"{{if eq .Kind "gif"}} autoplay loop muted{{end}}></video></div>{{end}}
      {{if isAudio .}}<div class="media"><audio src="{{.Media.Path}}" controls preload="none"></audio></div>{{end}}
      {{if isFile .}}<a class="file" href="{{.Media.Path}}" download><span class="icon">FILE</span><span><span class="name">{{if .Media.FileName}}{{.Media.FileName}}{{else}}{{base .Media.Path}}{{end}}</span><br><small>{{size .Media.Size}}</small></span></a>{{end}}
      {{if .MediaOmitted}}<div class="omitted">{{.Kind}} not included: {{.MediaOmitted}}</div>{{end}}
      {{with .Business}}{{if .Header}}<b>{{.Header}}</b>{{end}}{{end}}
      {{with .Location}}<div class="card">{{if .Thumb}}<img src="{{dataURL .Thumb}}" alt="">{{end}}<b>{{if .Name}}{{.Name}}{{else if .Live}}Live location{{else}}Location{{end}}</b><span class="sub">{{if .Address}}{{.Address}}{{else}}{{coord .Lat}}, {{coord .Lon}}{{end}}</span><div class="links"><a href="https://www.openstreetmap.org/?mlat={{.Lat}}&amp;mlon={{.Lon}}#map=16/{{.Lat}}/{{.Lon}}">OpenStreetMap</a><a href="https://www.google.com/maps/search/?api=1&amp;query={{.Lat}},{{.Lon}}">Google Maps</a></div></div>{{end}}
      {{range .Contacts}}<div class="card"><b>👤 {{.Name}}</b>{{if .Org}}<small>{{.Org}}</small>{{end}}{{range .Phones}}<div class="sub">{{.Number}}{{if .Label}} · {{.Label}}{{end}}</div>{{end}}{{range .Emails}}<div class="sub">{{.}}</div>{{end}}</div>{{end}}
      {{with .Event}}<div class="card"><b>📅 {{.Name}}{{if .Canceled}} (canceled){{end}}</b><div class="sub">{{when .Start}}{{if .End}} – {{clockMS .End}}{{end}}</div>{{if .Place}}<div class="sub">{{.Place}}</div>{{end}}{{if .JoinLink}}<div class="links"><a href="{{.JoinLink}}">Join link</a></div>{{end}}{{if .Description}}<p class="text">{{.Description}}</p>{{end}}</div>{{end}}
      {{with .Poll}}{{$top := votes .}}<div class="card"><b>📊 {{.Name}}</b>{{range .Options}}<div class="opt">{{.Name}} <small>· {{.Votes}}</small><div class="bar"><i style="width: {{pct .Votes $top}}%"></i></div></div>{{end}}</div>{{end}}
      {{if .Text}}<div class="text">{{rich .Text}}</div>{{else if and .Deleted (not .Media) (not .MediaOmitted)}}<p class="omitted">The content of this message is unknown</p>{{end}}
      {{with .Business}}{{if .Footer}}<small class="omitted">{{.Footer}}</small>{{end}}{{if .Buttons}}<div class="buttons">{{range .Buttons}}{{if .URL}}<a href="{{.URL}}">{{.Text}}</a>{{else}}<span>{{.Text}}</span>{{end}}{{end}}</div>{{end}}{{end}}
      {{with .Deleted}}<div class="note">Deleted by {{.By}} · {{full .At}} · kept by WhatsZori</div>{{end}}
      {{if .Edits}}<details><summary>Edited · {{len .Edits}} versions</summary><ol>{{range .Edits}}<li>{{.Text}} <small>({{full .At}})</small></li>{{end}}</ol></details>{{end}}
      {{if .Reactions}}<div class="reactions">{{range .Reactions}}<span>{{.Emoji}}{{if gt .Count 1}} {{.Count}}{{end}}</span>{{end}}</div>{{end}}
      <div class="meta">{{if .Disappearing}}<span class="timer" title="Disappearing message, kept by WhatsZori">⏱</span>{{end}}<span title="{{full .Time}}">{{clock .Time}}</span></div>
    </div>
  </div>
  {{end}}
  {{end}}
{{end}}
</main>
<footer>Exported with WhatsZori. Everything here was stored only on your computer.</footer>
</body>
</html>
`
