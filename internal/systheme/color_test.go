package systheme

import "testing"

func TestABGRToHex(t *testing.T) {
	cases := []struct {
		in   uint32
		want string
	}{
		{0xffd77800, "#0078d7"}, // Windows default blue
		{0xff0000ff, "#ff0000"},
		{0x0000ff00, "#00ff00"},
		{0x80ff0000, "#0000ff"}, // alpha is ignored
		{0x00000000, "#000000"},
		{0xffffffff, "#ffffff"},
		{0xff4a6fa5, "#a56f4a"},
	}
	for _, c := range cases {
		if got := ABGRToHex(c.in); got != c.want {
			t.Errorf("ABGRToHex(%#08x) = %s, want %s", c.in, got, c.want)
		}
	}
}

func TestAccentForeground(t *testing.T) {
	cases := map[string]string{
		"#0078d7": "#ffffff",
		"#ffd700": "#000000",
		"#60cdff": "#000000",
		"#000000": "#ffffff",
		"#ffffff": "#000000",
		"#3d6fb4": "#ffffff",
		"fff":     "#000000",
		"nope":    "",
	}
	for in, want := range cases {
		if got := AccentForeground(in); got != want {
			t.Errorf("AccentForeground(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRGBFloatToHex(t *testing.T) {
	if got, ok := RGBFloatToHex(0.2078, 0.5176, 0.8941); !ok || got != "#3584e4" {
		t.Errorf("got %s %v", got, ok)
	}
	if _, ok := RGBFloatToHex(-1, 0, 0); ok {
		t.Error("negative channel should mean unset")
	}
}
