package export

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
)

func TestRich(t *testing.T) {
	cases := map[string]string{
		"*bold* and _it_":         "<span><b>bold</b> and <i>it</i></span>",
		"<script>x</script>":      "<span>&lt;script&gt;x&lt;/script&gt;</span>",
		"> quoted\nplain":         "<blockquote>quoted</blockquote><span>plain</span>",
		"- a\n- *b*":              "<ul><li>a</li><li><b>b</b></li></ul>",
		"3. three\n4. four":       `<ol start="3"><li>three</li><li>four</li></ol>`,
		"```\nx = *1*\n```":       "<pre>x = *1*</pre>",
		"see https://x.test/a_b_": `<span>see <a href="https://x.test/a_b_" rel="noreferrer noopener">https://x.test/a_b_</a></span>`,
		"`*not bold*`":            "<span><code>*not bold*</code></span>",
	}
	for in, want := range cases {
		if got := string(rich(in)); got != want {
			t.Errorf("rich(%q)\n got %s\nwant %s", in, got, want)
		}
	}
}

func TestHTMLExtras(t *testing.T) {
	at := time.Date(2026, 11, 28, 12, 0, 0, 0, time.UTC)
	chat := Chat{Name: "T", Messages: []Message{
		{ID: "A1", Time: at, SenderJID: "a", Kind: "image", Media: &MediaFile{Path: "media/1.jpg"}},
		{ID: "A2", Time: at.Add(10 * time.Second), SenderJID: "a", Kind: "image", Media: &MediaFile{Path: "media/2.jpg"}, Text: "*lake*"},
		{ID: "L", Time: at.Add(time.Minute * 5), SenderJID: "a", Kind: "location", Location: &domain.LocationInfo{Lat: 1.5, Lon: 2.5, Name: "Home"}},
		{ID: "P", Time: at.Add(time.Minute * 6), SenderJID: "a", Kind: "poll", Poll: &domain.PollInfo{Name: "Lunch?", Options: []domain.PollOption{{Name: "Pizza", Votes: 2}, {Name: "Sushi", Votes: 1}}}},
	}}
	file := filepath.Join(t.TempDir(), "chat.html")
	if err := writeHTML(file, chat); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(file)
	page := string(b)
	for _, want := range []string{`<div class="album">`, `<b>lake</b>`, `Home`, `mlat=1.5`, `📊 Lunch?`, `width: 50%`} {
		if !strings.Contains(page, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if strings.Count(page, `class="bubble`) != 3 {
		t.Errorf("album not one bubble: %d bubbles", strings.Count(page, `class="bubble`))
	}
	txt := filepath.Join(t.TempDir(), "chat.txt")
	if err := writeTXT(txt, chat); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(txt)
	for _, want := range []string{"Home location: https://maps.google.com/?q=1.500000,2.500000", "POLL:\nLunch?\nOPTION: Pizza (2 votes)\nOPTION: Sushi (1 vote)"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("txt lacks %q:\n%s", want, b)
		}
	}
}

func TestHTMLPlaceThumb(t *testing.T) {
	chat := Chat{Name: "T", Messages: []Message{{ID: "L", Time: time.Now(), Kind: "location",
		Location: &domain.LocationInfo{Lat: 1, Lon: 2, Thumb: "data:image/jpeg;base64,AAAA"}}}}
	file := filepath.Join(t.TempDir(), "chat.html")
	if err := writeHTML(file, chat); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(file)
	if !strings.Contains(string(b), `src="data:image/jpeg;base64,AAAA"`) {
		t.Error("the map picture was dropped")
	}
}
