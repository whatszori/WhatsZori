package domain

import (
	"strings"
	"unicode"
)

// PlainText drops WhatsApp's formatting markers (*bold*, _italic_, ~strike~, `code`,
// ```mono```) for places that show plain text: notifications and the like. The rules match the
// app's own renderer (frontend/src/lib/markdown.ts): a marker counts only next to a space,
// punctuation or the edge, with no space just inside it, and never inside a link.
func PlainText(s string) string {
	if !strings.ContainsAny(s, "*_~`") {
		return s
	}
	// ```code``` keeps what's inside as typed
	var b strings.Builder
	for {
		a := strings.Index(s, "```")
		if a < 0 {
			break
		}
		e := strings.Index(s[a+3:], "```")
		if e < 0 {
			break
		}
		b.WriteString(plain(s[:a]))
		b.WriteString(s[a+3 : a+3+e])
		s = s[a+3+e+3:]
	}
	b.WriteString(plain(s))
	return b.String()
}

func plain(s string) string {
	r := []rune(s)
	links := linkRanges(r)
	inLink := func(i int) bool {
		for _, l := range links {
			if i >= l[0] && i < l[1] {
				return true
			}
		}
		return false
	}
	edge := func(c rune) bool { return unicode.IsSpace(c) || unicode.IsPunct(c) || unicode.IsSymbol(c) }
	drop := make([]bool, len(r))
	var walk func(from, to int)
	walk = func(from, to int) {
		for i := from; i < to; i++ {
			c := r[i]
			if c != '*' && c != '_' && c != '~' && c != '`' {
				continue
			}
			if inLink(i) || (i > from && (!edge(r[i-1]) || r[i-1] == c)) || i+1 >= to || unicode.IsSpace(r[i+1]) || r[i+1] == c {
				continue
			}
			for j := i + 2; j < to; j++ {
				if r[j] == '\n' {
					break
				}
				if r[j] == c && !inLink(j) && !unicode.IsSpace(r[j-1]) && (j+1 == to || (edge(r[j+1]) && r[j+1] != c)) {
					drop[i], drop[j] = true, true
					if c != '`' {
						walk(i+1, j)
					}
					i = j
					break
				}
			}
		}
	}
	walk(0, len(r))
	var b strings.Builder
	for i, c := range r {
		if !drop[i] {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func linkRanges(r []rune) [][2]int {
	var out [][2]int
	s := string(r)
	for _, p := range []string{"https://", "http://", "www."} {
		off := 0
		for {
			k := strings.Index(s[off:], p)
			if k < 0 {
				break
			}
			start := len([]rune(s[:off+k]))
			end := start
			for end < len(r) && !unicode.IsSpace(r[end]) {
				end++
			}
			out = append(out, [2]int{start, end})
			off += k + len(p)
		}
	}
	return out
}
