package services

import "testing"

func TestPhoneDigits(t *testing.T) {
	for in, want := range map[string]string{
		"+7 (912) 345-67-89": "79123456789",
		"0049 151 2345678":   "491512345678",
		"+44.20.7946.0958":   "442079460958",
		"12345":              "",
		"0151 2345678":       "",
		"+49 151 abc":        "",
		"":                   "",
	} {
		if got := PhoneDigits(in); got != want {
			t.Errorf("PhoneDigits(%q) = %q, want %q", in, got, want)
		}
	}
}
