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

type htmlDay struct {
	Label    string
	Messages []Message
}

type htmlData struct {
	Chat Chat
	Days []htmlDay
}

func writeHTML(file string, chat Chat) error {
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
  <div class="msg {{if .FromMe}}out{{else}}in{{end}}" id="m-{{.ID}}">
    <div class="bubble{{if .Deleted}} deleted{{end}}">
      {{if and $.Chat.IsGroup (not .FromMe)}}<div class="sender">{{.Sender}}</div>{{end}}
      {{with .ReplyTo}}<a class="quote" href="#m-{{.ID}}" style="display:block;color:inherit;text-decoration:none"><b>{{.Sender}}</b>{{.Text}}</a>{{end}}
      {{if isImage .}}<div class="media{{if eq .Kind "sticker"}} sticker{{end}}"><a href="{{.Media.Path}}"><img src="{{.Media.Path}}" alt="" loading="lazy"></a></div>{{end}}
      {{if isVideo .}}<div class="media{{if eq .Kind "round"}} round{{end}}"><video src="{{.Media.Path}}" controls preload="metadata"{{if eq .Kind "gif"}} autoplay loop muted{{end}}></video></div>{{end}}
      {{if isAudio .}}<div class="media"><audio src="{{.Media.Path}}" controls preload="none"></audio></div>{{end}}
      {{if isFile .}}<a class="file" href="{{.Media.Path}}" download><span class="icon">FILE</span><span><span class="name">{{if .Media.FileName}}{{.Media.FileName}}{{else}}{{base .Media.Path}}{{end}}</span><br><small>{{size .Media.Size}}</small></span></a>{{end}}
      {{if .MediaOmitted}}<div class="omitted">{{.Kind}} not included: {{.MediaOmitted}}</div>{{end}}
      {{if .Text}}<p class="text">{{.Text}}</p>{{else if and .Deleted (not .Media) (not .MediaOmitted)}}<p class="omitted">The content of this message is unknown</p>{{end}}
      {{with .Deleted}}<div class="note">Deleted by {{.By}} · {{full .At}} · kept by WhatsZori</div>{{end}}
      {{if .Edits}}<details><summary>Edited · {{len .Edits}} versions</summary><ol>{{range .Edits}}<li>{{.Text}} <small>({{full .At}})</small></li>{{end}}</ol></details>{{end}}
      {{if .Reactions}}<div class="reactions">{{range .Reactions}}<span>{{.Emoji}}{{if gt .Count 1}} {{.Count}}{{end}}</span>{{end}}</div>{{end}}
      <div class="meta"><span title="{{full .Time}}">{{clock .Time}}</span></div>
    </div>
  </div>
  {{end}}
{{end}}
</main>
<footer>Exported with WhatsZori. Everything here was stored only on your computer.</footer>
</body>
</html>
`
