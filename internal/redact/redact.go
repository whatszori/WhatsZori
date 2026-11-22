// Package redact keeps phone numbers and message content out of logs.
package redact

import (
	"regexp"
	"strings"
)

// JID turns "491701234567@s.whatsapp.net" into "49…67@s.whatsapp.net". Group and LID ids aren't
// phone numbers, but they're still personal, so they get the same treatment.
func JID(s string) string {
	user, server, found := strings.Cut(s, "@")
	if !found {
		return Digits(s)
	}
	return mask(user) + "@" + server
}

func mask(user string) string {
	// keep the device suffix ("…:12") readable, it helps when debugging multi-device issues
	user, device, hasDevice := strings.Cut(user, ":")
	out := user
	if len(user) > 4 {
		out = user[:2] + "…" + user[len(user)-2:]
	}
	if hasDevice {
		out += ":" + device
	}
	return out
}

var longDigits = regexp.MustCompile(`\d{6,}`)

// Digits masks every run of six or more digits, which covers phone numbers and JID users inside
// free-form log lines (whatsmeow's own logs, for example).
func Digits(s string) string {
	return longDigits.ReplaceAllStringFunc(s, func(m string) string {
		return m[:2] + "…" + m[len(m)-2:]
	})
}
