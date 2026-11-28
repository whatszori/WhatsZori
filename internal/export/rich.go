package export

import (
	"html"
	"html/template"
	"regexp"
	"strconv"
	"strings"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// rich draws WhatsApp's formatting as HTML for the export, like the app's bubbles do: emphasis,
// code, links, "> " quotes, "- " / "1. " lists and ``` blocks. Everything is escaped first.
func rich(s string) template.HTML {
	var b strings.Builder
	last := 0
	for _, m := range codeBlock.FindAllStringSubmatchIndex(s, -1) {
		lines(&b, strings.TrimSuffix(s[last:m[0]], "\n"))
		b.WriteString("<pre>" + html.EscapeString(strings.TrimSuffix(s[m[2]:m[3]], "\n")) + "</pre>")
		last = m[1]
		if last < len(s) && s[last] == '\n' {
			last++
		}
	}
	lines(&b, s[last:])
	return template.HTML(b.String())
}

var (
	codeBlock = regexp.MustCompile("(?s)```\\n?(.*?\\n.*?)\\n?```")
	quoteLine = regexp.MustCompile(`^> ?(.*)$`)
	bullet    = regexp.MustCompile(`^[-*•] (.+)$`)
	numbered  = regexp.MustCompile(`^(\d{1,3})\. (.+)$`)
)

func lines(b *strings.Builder, s string) {
	if s == "" {
		return
	}
	var para, quote []string
	var ul []string
	var ol []string
	olStart := 1
	flush := func() {
		if len(para) > 0 {
			b.WriteString("<span>" + inline(strings.Join(para, "\n")) + "</span>")
		}
		if len(quote) > 0 {
			b.WriteString("<blockquote>" + inline(strings.Join(quote, "\n")) + "</blockquote>")
		}
		if len(ul) > 0 {
			b.WriteString("<ul>")
			for _, it := range ul {
				b.WriteString("<li>" + inline(it) + "</li>")
			}
			b.WriteString("</ul>")
		}
		if len(ol) > 0 {
			b.WriteString(`<ol start="` + strconv.Itoa(olStart) + `">`)
			for _, it := range ol {
				b.WriteString("<li>" + inline(it) + "</li>")
			}
			b.WriteString("</ol>")
		}
		para, quote, ul, ol = nil, nil, nil, nil
	}
	for _, line := range strings.Split(s, "\n") {
		switch {
		case quoteLine.MatchString(line):
			if len(quote) == 0 {
				flush()
			}
			quote = append(quote, quoteLine.FindStringSubmatch(line)[1])
		case bullet.MatchString(line):
			if len(ul) == 0 {
				flush()
			}
			ul = append(ul, bullet.FindStringSubmatch(line)[1])
		case numbered.MatchString(line):
			m := numbered.FindStringSubmatch(line)
			if len(ol) == 0 {
				flush()
				olStart, _ = strconv.Atoi(m[1])
			}
			ol = append(ol, m[2])
		default:
			if len(para) == 0 {
				flush()
			}
			para = append(para, line)
		}
	}
	flush()
}

var tags = map[rune][2]string{
	'*': {"<b>", "</b>"},
	'_': {"<i>", "</i>"},
	'~': {"<s>", "</s>"},
	'`': {"<code>", "</code>"},
}

// inline: one-line ```mono```, then emphasis and links, escaping everything else.
func inline(s string) string {
	var b strings.Builder
	for {
		a := strings.Index(s, "```")
		if a < 0 {
			break
		}
		e := strings.Index(s[a+3:], "```")
		if e < 0 || strings.Contains(s[a+3:a+3+e], "\n") {
			break
		}
		b.WriteString(emphasis(s[:a]))
		b.WriteString("<code>" + html.EscapeString(s[a+3:a+3+e]) + "</code>")
		s = s[a+3+e+3:]
	}
	b.WriteString(emphasis(s))
	return b.String()
}

func emphasis(s string) string {
	r := []rune(s)
	open := map[int]string{}
	close := map[int]string{}
	code := make([]bool, len(r))
	for _, sp := range domain.Spans(r) {
		open[sp.Open] = tags[sp.Mark][0]
		close[sp.Close] = tags[sp.Mark][1]
		if sp.Mark == '`' {
			for i := sp.Open; i <= sp.Close; i++ {
				code[i] = true
			}
		}
	}
	linkAt := map[int]int{}
	for _, l := range domain.LinkRanges(r) {
		linkAt[l[0]] = l[1]
	}
	var b strings.Builder
	for i := 0; i < len(r); i++ {
		if t, ok := open[i]; ok {
			b.WriteString(t)
			continue
		}
		if t, ok := close[i]; ok {
			b.WriteString(t)
			continue
		}
		if end, ok := linkAt[i]; ok && !code[i] {
			u := string(r[i:end])
			href := u
			if strings.HasPrefix(u, "www.") {
				href = "https://" + u
			}
			b.WriteString(`<a href="` + html.EscapeString(href) + `" rel="noreferrer noopener">` + html.EscapeString(u) + "</a>")
			i = end - 1
			continue
		}
		b.WriteString(html.EscapeString(string(r[i])))
	}
	return b.String()
}
