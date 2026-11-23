package themes

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPackages(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(body), 0o644)
	}
	write("ocean/manifest.json", `{"id":"ocean","name":"Ocean","version":"1.0","layout":"panels",
		"modules":[{"id":"palette","name":"Palette","file":"palette.css","required":true},
		           {"id":"bg","name":"Background","file":"parts/bg.css","default":false}]}`)
	write("ocean/palette.css", ":root { --wz-accent: #0af; }")
	write("ocean/parts/bg.css", `.x { background: url(waves.png), url('../img/a.svg'), url("data:image/png;base64,AA"), url(/abs.png), url(https://e.com/x.png); }`)
	write("bad-id/manifest.json", `{"id":"other","modules":[{"id":"a","file":"a.css"}]}`)
	write("escape/manifest.json", `{"id":"escape","modules":[{"id":"a","file":"../ocean/palette.css"}]}`)
	write("missing/manifest.json", `{"id":"missing","modules":[{"id":"a","file":"a.css"}]}`)
	write("_wallpapers/x.jpg", "jpg")
	write("assets-only/logo.png", "png")
	write("single.css", "/* @name Single */")

	pkgs, err := Packages(dir)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Package{}
	for _, p := range pkgs {
		byID[p.Manifest.ID] = p
	}
	if len(pkgs) != 4 {
		t.Fatalf("want 4 packages (folders with a manifest), got %d: %+v", len(pkgs), pkgs)
	}
	ocean := byID["ocean"]
	if ocean.Error != "" || ocean.CSS["palette.css"] == "" || len(ocean.Manifest.Modules) != 2 {
		t.Fatalf("ocean: %+v", ocean)
	}
	want := `.x { background: url("/wz-themes/ocean/parts/waves.png"), url("/wz-themes/ocean/img/a.svg"), url("data:image/png;base64,AA"), url(/abs.png), url(https://e.com/x.png); }`
	if got := ocean.CSS["parts/bg.css"]; got != want {
		t.Errorf("urls:\n got %s\nwant %s", got, want)
	}
	if d := ocean.Manifest.Modules[1].Default; d == nil || *d {
		t.Error("default:false lost")
	}
	for _, id := range []string{"escape", "missing"} {
		if byID[id].Error == "" {
			t.Errorf("%s should be broken", id)
		}
	}
	if byID["bad-id"].Error == "" {
		t.Error("id/folder mismatch accepted")
	}
}
