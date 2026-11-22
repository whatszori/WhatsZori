package redact

import "testing"

func TestJID(t *testing.T) {
	cases := map[string]string{
		"491701234567@s.whatsapp.net":    "49…67@s.whatsapp.net",
		"491701234567:12@s.whatsapp.net": "49…67:12@s.whatsapp.net",
		"123@lid":                        "123@lid",
		"491701234567":                   "49…67",
	}
	for in, want := range cases {
		if got := JID(in); got != want {
			t.Errorf("JID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDigits(t *testing.T) {
	got := Digits("send to 491701234567 failed, retry 3")
	if got != "send to 49…67 failed, retry 3" {
		t.Errorf("got %q", got)
	}
}
