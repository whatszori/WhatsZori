package domain

import "testing"

func TestPlainText(t *testing.T) {
	cases := map[string]string{
		"*bold* _it_ ~gone~ `code`": "bold it gone code",
		"*_both_*":                  "both",
		"```x = *1*```":             "x = *1*",
		"(*yes*), ok":               "(yes), ok",
		"snake_case_name":           "snake_case_name",
		"2*3*4":                     "2*3*4",
		"a * b * c":                 "a * b * c",
		"https://x.test/a_b_c":      "https://x.test/a_b_c",
		"*not closed":               "*not closed",
		"*привет* мир":              "привет мир",
	}
	for in, want := range cases {
		if got := PlainText(in); got != want {
			t.Errorf("PlainText(%q) = %q, want %q", in, got, want)
		}
	}
}
