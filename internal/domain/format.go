package domain

import (
	"strings"
	"unicode"
)

// WhatsApp's text formatting markers: *bold*, _italic_, ~strike~, `code`, ```mono```. The rules
// match the app's own renderer (frontend/src/lib/markdown.ts): a marker counts only next to a
// space, punctuation or the edge, with no space just inside it, and never inside a link.

// PlainText drops the markers, for places that show plain text: notifications and the like.
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

// Span is one pair of formatting markers: the rune indexes of the opening and closing marker.
type Span struct {
	Open, Close int
	Mark        rune
}

// Spans finds the inline formatting pairs in r (not triple-backtick blocks), nested ones too,
// in order of their opening marker.
func Spans(r []rune) []Span {
	links := LinkRanges(r)
	inLink := func(i int) bool {
		for _, l := range links {
			if i >= l[0] && i < l[1] {
				return true
			}
		}
		return false
	}
	edge := func(c rune) bool { return unicode.IsSpace(c) || unicode.IsPunct(c) || unicode.IsSymbol(c) }
	var out []Span
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
					out = append(out, Span{Open: i, Close: j, Mark: c})
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
	return out
}

func plain(s string) string {
	r := []rune(s)
	drop := make([]bool, len(r))
	for _, sp := range Spans(r) {
		drop[sp.Open], drop[sp.Close] = true, true
	}
	var b strings.Builder
	for i, c := range r {
		if !drop[i] {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// LinkRanges are the rune ranges [start, end) of the links in r.
func LinkRanges(r []rune) [][2]int {
	var out [][2]int
	for i := 0; i < len(r); i++ {
		rest := string(r[i:min(len(r), i+8)])
		if !strings.HasPrefix(rest, "https://") && !strings.HasPrefix(rest, "http://") && !strings.HasPrefix(rest, "www.") {
			continue
		}
		if i > 0 && !unicode.IsSpace(r[i-1]) && !unicode.IsPunct(r[i-1]) {
			continue
		}
		end := i
		for end < len(r) && !unicode.IsSpace(r[end]) {
			end++
		}
		// trailing punctuation belongs to the sentence
		for end > i && strings.ContainsRune(".,;:!?)]}'\"»", r[end-1]) {
			end--
		}
		out = append(out, [2]int{i, end})
		i = end
	}
	return out
}
