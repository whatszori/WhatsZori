package services

import "testing"

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"photo.jpg":              "photo.jpg",
		`..\..\Windows\evil.exe`: "evil.exe",
		"../../etc/passwd":       "passwd",
		`a:b*c?.pdf`:             "a_b_c_.pdf",
		"report. ":               "report",
		"..":                     "file",
		"":                       "file",
	}
	for in, want := range cases {
		if got := sanitizeName(in); got != want {
			t.Errorf("sanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}
