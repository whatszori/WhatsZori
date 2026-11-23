package clip

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"testing"
	"unicode/utf16"
)

func TestDropFiles(t *testing.T) {
	b := DropFiles([]string{`C:\Users\me\Видео\clip.mp4`})
	le := binary.LittleEndian
	if le.Uint32(b[0:]) != 20 || le.Uint32(b[16:]) != 1 {
		t.Fatalf("header: offset=%d wide=%d", le.Uint32(b[0:]), le.Uint32(b[16:]))
	}
	var u []uint16
	for i := 20; i < len(b); i += 2 {
		u = append(u, le.Uint16(b[i:]))
	}
	if u[len(u)-1] != 0 || u[len(u)-2] != 0 {
		t.Fatal("list isn't double-null terminated")
	}
	if got := string(utf16.Decode(u[:len(u)-2])); got != `C:\Users\me\Видео\clip.mp4` {
		t.Errorf("path = %q", got)
	}
}

func TestPicture(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255}) // top-left red
	img.Set(1, 1, color.NRGBA{B: 255, A: 128}) // bottom-right half-transparent blue
	var buf bytes.Buffer
	png.Encode(&buf, img)

	p, err := NewPicture(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	le := binary.LittleEndian
	d := p.DIB
	if le.Uint32(d[0:]) != 40 || le.Uint32(d[4:]) != 2 || le.Uint32(d[8:]) != 2 || le.Uint16(d[14:]) != 32 {
		t.Fatalf("bad header % x", d[:16])
	}
	px := d[40:]
	// bottom-up: the first row in memory is the bottom row; BGRA order
	if px[4] != 255 || px[5] != 0 || px[6] != 0 || px[7] != 128 {
		t.Errorf("bottom-right pixel = % x, want blue with alpha 128", px[4:8])
	}
	if px[8+2] != 255 || px[8+0] != 0 {
		t.Errorf("top-left pixel = % x, want red", px[8:12])
	}
	if _, err := png.Decode(bytes.NewReader(p.PNG)); err != nil {
		t.Errorf("PNG doesn't decode: %v", err)
	}
	if _, err := NewPicture([]byte("not an image")); err == nil {
		t.Error("garbage decoded as a picture")
	}
}
