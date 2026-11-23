package voice

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"testing"
)

func TestRealRecording(t *testing.T) {
	webm, err := os.ReadFile("testdata/sine.webm")
	if err != nil {
		t.Fatal(err)
	}
	ogg, secs, err := ToOgg(webm)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(secs-2) > 0.1 {
		t.Errorf("duration %.3f, want ~2", secs)
	}
	pages := checkPages(t, ogg)
	if pages < 3 {
		t.Errorf("only %d pages", pages)
	}
	if os.Getenv("WZ_WRITE_OGG") != "" {
		os.WriteFile(os.Getenv("WZ_WRITE_OGG"), ogg, 0o644)
	}
}

// checkPages walks the Ogg pages, verifying capture pattern, CRC, sequence and the BOS/EOS flags.
func checkPages(t *testing.T, b []byte) int {
	t.Helper()
	n := 0
	for len(b) > 0 {
		if len(b) < 27 || string(b[:4]) != "OggS" {
			t.Fatalf("page %d: bad capture pattern", n)
		}
		segs := int(b[26])
		size := 27 + segs
		for _, s := range b[27 : 27+segs] {
			size += int(s)
		}
		page := append([]byte(nil), b[:size]...)
		want := binary.LittleEndian.Uint32(page[22:])
		binary.LittleEndian.PutUint32(page[22:], 0)
		if got := oggCRC(page); got != want {
			t.Fatalf("page %d: crc %08x, want %08x", n, got, want)
		}
		if seq := binary.LittleEndian.Uint32(b[18:]); seq != uint32(n) {
			t.Fatalf("page %d: sequence %d", n, seq)
		}
		flags := b[5]
		if (n == 0) != (flags&flagBOS != 0) {
			t.Errorf("page %d: BOS flag wrong", n)
		}
		b = b[size:]
		if len(b) == 0 && flags&flagEOS == 0 {
			t.Error("last page without EOS")
		}
		n++
	}
	return n
}

// what a browser's MediaRecorder writes: segment and clusters with unknown size
func TestStreamedWebM(t *testing.T) {
	el := func(id []byte, body []byte) []byte {
		size := []byte{0x80 | byte(len(body))} // fine for bodies < 127 bytes
		return append(append(append([]byte{}, id...), size...), body...)
	}
	unknown := []byte{0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}
	frame := append([]byte{0xFC}, bytes.Repeat([]byte{1}, 20)...) // CELT 20 ms, 1 frame
	block := el([]byte{0xA3}, append([]byte{0x81, 0, 0, 0x80}, frame...))
	tracks := el([]byte{0x16, 0x54, 0xAE, 0x6B}, el([]byte{0xAE}, el([]byte{0x86}, []byte("A_OPUS"))))
	var data []byte
	data = append(data, el([]byte{0x1A, 0x45, 0xDF, 0xA3}, []byte{0x42, 0x82, 0x84, 'w', 'e', 'b', 'm'})...)
	data = append(data, 0x18, 0x53, 0x80, 0x67)
	data = append(data, unknown...)
	data = append(data, tracks...)
	for range 3 {
		data = append(data, 0x1F, 0x43, 0xB6, 0x75)
		data = append(data, unknown...)
		data = append(data, el([]byte{0xE7}, []byte{0})...)
		data = append(data, block...)
		data = append(data, block...)
	}
	ogg, secs, err := ToOgg(data)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(secs-0.12) > 1e-9 {
		t.Errorf("duration %.3f, want 0.120 (6 x 20 ms)", secs)
	}
	checkPages(t, ogg)
}

func TestNotOpus(t *testing.T) {
	if _, _, err := ToOgg([]byte("RIFF....WAVE")); err == nil {
		t.Error("accepted a wav")
	}
}

func TestOpusSamples(t *testing.T) {
	cases := map[byte]int{0x00: 480, 0x08: 960, 0x18: 2880, 0xF8: 960, 0x80: 120, 0xF9: 1920}
	for toc, want := range cases {
		if got := opusSamples([]byte{toc, 0}); got != want {
			t.Errorf("toc %02x: %d samples, want %d", toc, got, want)
		}
	}
	if got := opusSamples([]byte{0xFB, 0x03}); got != 3*960 {
		t.Errorf("code 3 with 3 frames: %d", got)
	}
}

// a real MediaRecorder recording from Edge (unknown-size segment and clusters)
func TestBrowserRecording(t *testing.T) {
	webm, err := os.ReadFile("testdata/mediarecorder.webm")
	if err != nil {
		t.Fatal(err)
	}
	ogg, secs, err := ToOgg(webm)
	if err != nil {
		t.Fatal(err)
	}
	if secs < 2.5 || secs > 3.5 {
		t.Errorf("duration %.2f, want ~3", secs)
	}
	checkPages(t, ogg)
	if p := os.Getenv("WZ_WRITE_OGG2"); p != "" {
		os.WriteFile(p, ogg, 0o644)
	}
}
