package sticker

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func pngOf(w, h int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: 120, B: uint8(y), A: 255})
		}
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func TestPrepare(t *testing.T) {
	out, err := Prepare(pngOf(300, 150))
	if err != nil {
		t.Fatal(err)
	}
	if !isWebP(out) {
		t.Fatal("not a webp")
	}
	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != Size || b.Dy() != Size {
		t.Fatalf("size %v", b)
	}
	// wide picture: transparent above and below, opaque in the middle
	if _, _, _, a := img.At(256, 10).RGBA(); a != 0 {
		t.Error("top should be transparent")
	}
	if _, _, _, a := img.At(256, 256).RGBA(); a == 0 {
		t.Error("middle should be the picture")
	}
	// a ready sticker passes through untouched
	again, err := Prepare(out)
	if err != nil || !bytes.Equal(again, out) {
		t.Errorf("ready sticker changed: %v", err)
	}
	if _, err := Prepare([]byte("hello")); err != ErrNotImage {
		t.Errorf("text: %v", err)
	}
}
