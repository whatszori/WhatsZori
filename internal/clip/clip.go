// Package clip puts a file on the system clipboard, so it can be pasted into a file manager or
// another app. The webview's own clipboard only takes text and PNG, which rules out video.
package clip

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"unicode/utf16"

	_ "golang.org/x/image/webp"
)

var ErrUnsupported = errors.New("copying files isn't supported on this system")

// Copy puts path on the clipboard as a file. When asImage is set and the file decodes as a
// picture, the picture goes along too (as a bitmap and as PNG), so pasting into an image editor
// or a chat gives the picture rather than a file.
func Copy(path string, imageData []byte) error {
	var pic *Picture
	if len(imageData) > 0 {
		if p, err := NewPicture(imageData); err == nil {
			pic = p
		}
	}
	return copyFile(path, pic)
}

// Picture is an image ready for the clipboard formats we write.
type Picture struct {
	PNG []byte
	DIB []byte
}

func NewPicture(data []byte) (*Picture, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return &Picture{PNG: buf.Bytes(), DIB: DIB(img)}, nil
}

// DIB is a 32-bit bottom-up BITMAPINFOHEADER bitmap (CF_DIB), what Windows apps paste.
func DIB(img image.Image) []byte {
	b := img.Bounds()
	rgba := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	w, h := b.Dx(), b.Dy()
	out := make([]byte, 40+w*h*4)
	le := binary.LittleEndian
	le.PutUint32(out[0:], 40)             // biSize
	le.PutUint32(out[4:], uint32(w))      // biWidth
	le.PutUint32(out[8:], uint32(h))      // biHeight, positive = bottom-up
	le.PutUint16(out[12:], 1)             // biPlanes
	le.PutUint16(out[14:], 32)            // biBitCount
	le.PutUint32(out[20:], uint32(w*h*4)) // biSizeImage (BI_RGB, compression stays 0)
	px := out[40:]
	for y := range h {
		src := rgba.Pix[y*rgba.Stride:]
		dst := px[(h-1-y)*w*4:]
		for x := range w {
			r, g, bl, a := src[x*4], src[x*4+1], src[x*4+2], src[x*4+3]
			dst[x*4], dst[x*4+1], dst[x*4+2], dst[x*4+3] = bl, g, r, a
		}
	}
	return out
}

// DropFiles builds the CF_HDROP payload: a DROPFILES header and a double-null-terminated UTF-16
// list of paths.
func DropFiles(paths []string) []byte {
	var names []uint16
	for _, p := range paths {
		names = append(names, utf16.Encode([]rune(p))...)
		names = append(names, 0)
	}
	names = append(names, 0)
	out := make([]byte, 20+len(names)*2)
	le := binary.LittleEndian
	le.PutUint32(out[0:], 20) // pFiles: offset of the list
	le.PutUint32(out[16:], 1) // fWide: UTF-16
	for i, c := range names {
		le.PutUint16(out[20+i*2:], c)
	}
	return out
}
