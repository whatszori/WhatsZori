// Package sticker turns pictures into WhatsApp stickers: 512×512 WebP with a transparent border.
package sticker

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/HugoSmits86/nativewebp"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	Size = 512
	// stickers we make or accept; WhatsApp's own maker stays far below this
	MaxBytes = 1 << 20
	// what we'll decode at all
	maxInput = 25 << 20
)

var ErrNotImage = errors.New("that file isn't a picture WhatsZori can read")

func isWebP(b []byte) bool {
	return len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP"
}

// Prepare returns data as a sticker. A WebP that's already 512×512 and small enough is kept as it
// is (the webview's own encoder makes much smaller lossy files than ours); anything else is fitted
// into 512×512 and encoded as lossless WebP.
func Prepare(data []byte) ([]byte, error) {
	if len(data) == 0 || len(data) > maxInput {
		return nil, ErrNotImage
	}
	if isWebP(data) {
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil &&
			cfg.Width == Size && cfg.Height == Size && len(data) <= MaxBytes {
			return data, nil
		}
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrNotImage
	}
	out, err := encode(Fit(img))
	if err != nil {
		return nil, err
	}
	if len(out) > MaxBytes {
		return nil, fmt.Errorf("the sticker came out at %d KB, over %d KB; try a simpler picture", len(out)>>10, MaxBytes>>10)
	}
	return out, nil
}

// Fit scales img to fit inside 512×512, centred on a transparent canvas.
func Fit(img image.Image) *image.NRGBA {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return image.NewNRGBA(image.Rect(0, 0, Size, Size))
	}
	tw, th := Size, Size
	if w > h {
		th = max(1, h*Size/w)
	} else {
		tw = max(1, w*Size/h)
	}
	dst := image.NewNRGBA(image.Rect(0, 0, Size, Size))
	x, y := (Size-tw)/2, (Size-th)/2
	xdraw.CatmullRom.Scale(dst, image.Rect(x, y, x+tw, y+th), img, b, draw.Over, nil)
	return dst
}

func encode(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := nativewebp.Encode(&buf, img, nil); err != nil {
		return nil, fmt.Errorf("couldn't make the sticker: %w", err)
	}
	return buf.Bytes(), nil
}
