package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestTrayIcon(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 192, 192))
	for i := range src.Pix {
		src.Pix[i] = 0x80
	}
	for _, dot := range []bool{false, true} {
		img, err := png.Decode(bytes.NewReader(encodeIcon(src, dot)))
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != trayIconSize || b.Dy() != trayIconSize {
			t.Fatalf("size %v", b)
		}
		r, _, _, _ := img.At(24, 24).RGBA()
		red := color.NRGBAModel.Convert(img.At(24, 24)).(color.NRGBA).R == 0xd9
		if dot != red {
			t.Errorf("dot=%v but centre pixel red=%v (r=%d)", dot, red, r)
		}
	}
}
