package systheme

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ABGRToHex turns a Windows DWM color DWORD (0xAABBGGRR) into "#rrggbb". Alpha is dropped.
func ABGRToHex(v uint32) string {
	r := v & 0xff
	g := (v >> 8) & 0xff
	b := (v >> 16) & 0xff
	return fmt.Sprintf("#%02x%02x%02x", r, g, b)
}

// RGBFloatToHex converts 0..1 channels (what the XDG portal sends). Out of range means "unset".
func RGBFloatToHex(r, g, b float64) (string, bool) {
	for _, c := range []float64{r, g, b} {
		if c < 0 || c > 1 || math.IsNaN(c) {
			return "", false
		}
	}
	to := func(c float64) uint8 { return uint8(math.Round(c * 255)) }
	return fmt.Sprintf("#%02x%02x%02x", to(r), to(g), to(b)), true
}

func ParseHex(hex string) (r, g, b uint8, ok bool) {
	h := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return 0, 0, 0, false
	}
	n, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	return uint8(n >> 16), uint8(n >> 8), uint8(n), true
}

// AccentForeground picks black or white text for the accent by WCAG contrast. White gets a 10%
// head start: on mid-tones like Windows' default blue (#0078d7) plain WCAG picks black by a
// hair, and every OS uses white there.
func AccentForeground(hex string) string {
	r, g, b, ok := ParseHex(hex)
	if !ok {
		return ""
	}
	l := RelativeLuminance(r, g, b)
	onWhite := 1.05 / (l + 0.05)
	onBlack := (l + 0.05) / 0.05
	if onBlack > onWhite*1.1 {
		return "#000000"
	}
	return "#ffffff"
}

func RelativeLuminance(r, g, b uint8) float64 {
	lin := func(c uint8) float64 {
		s := float64(c) / 255
		if s <= 0.04045 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}
