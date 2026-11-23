package voice

import (
	"bytes"
	"encoding/binary"
)

// Ogg's CRC: polynomial 0x04c11db7, not reflected, initial 0 (unlike the zip one).
var oggCRCTable = func() [256]uint32 {
	var t [256]uint32
	for i := range t {
		r := uint32(i) << 24
		for range 8 {
			if r&0x80000000 != 0 {
				r = r<<1 ^ 0x04c11db7
			} else {
				r <<= 1
			}
		}
		t[i] = r
	}
	return t
}()

func oggCRC(b []byte) uint32 {
	var crc uint32
	for _, c := range b {
		crc = crc<<8 ^ oggCRCTable[byte(crc>>24)^c]
	}
	return crc
}

const (
	flagBOS = 0x02
	flagEOS = 0x04
	serial  = 0x575A4F52 // "WZOR"
	// a page holds at most 255 segments; keep audio pages around a second long
	maxPacketsPerPage = 50
)

type oggWriter struct {
	buf bytes.Buffer
	seq uint32
}

func (w *oggWriter) page(packets [][]byte, granule uint64, flags byte) {
	var segs []byte
	for _, p := range packets {
		n := len(p)
		for n >= 255 {
			segs = append(segs, 255)
			n -= 255
		}
		// a packet that's an exact multiple of 255 ends with a 0-length segment
		segs = append(segs, byte(n))
	}
	hdr := make([]byte, 27, 27+len(segs))
	copy(hdr, "OggS")
	hdr[5] = flags
	binary.LittleEndian.PutUint64(hdr[6:], granule)
	binary.LittleEndian.PutUint32(hdr[14:], serial)
	binary.LittleEndian.PutUint32(hdr[18:], w.seq)
	hdr[26] = byte(len(segs))
	hdr = append(hdr, segs...)
	w.seq++

	page := append([]byte(nil), hdr...)
	for _, p := range packets {
		page = append(page, p...)
	}
	binary.LittleEndian.PutUint32(page[22:], oggCRC(page))
	w.buf.Write(page)
}

// opusSamples is how many 48 kHz samples an Opus packet holds, from its TOC byte (RFC 6716 3.1).
func opusSamples(p []byte) int {
	if len(p) == 0 {
		return 0
	}
	toc := p[0]
	cfg := toc >> 3
	var frame int // in 48 kHz samples
	switch {
	case cfg < 12: // SILK: 10, 20, 40, 60 ms
		frame = []int{480, 960, 1920, 2880}[cfg%4]
	case cfg < 16: // hybrid: 10, 20 ms
		frame = []int{480, 960}[cfg%2]
	default: // CELT: 2.5, 5, 10, 20 ms
		frame = []int{120, 240, 480, 960}[cfg%4]
	}
	switch toc & 3 {
	case 0:
		return frame
	case 1, 2:
		return 2 * frame
	default:
		if len(p) < 2 {
			return 0
		}
		return int(p[1]&0x3F) * frame
	}
}

func opusHead(channels int) []byte {
	h := make([]byte, 19)
	copy(h, "OpusHead")
	h[8] = 1
	h[9] = byte(channels)
	binary.LittleEndian.PutUint16(h[10:], 312) // pre-skip, what libopus uses at 48 kHz
	binary.LittleEndian.PutUint32(h[12:], 48000)
	return h
}

func opusTags() []byte {
	vendor := "WhatsZori"
	t := make([]byte, 8+4+len(vendor)+4)
	copy(t, "OpusTags")
	binary.LittleEndian.PutUint32(t[8:], uint32(len(vendor)))
	copy(t[12:], vendor)
	return t
}

// ToOgg rewraps a WebM/Opus recording as Ogg/Opus and returns it with its length in seconds.
func ToOgg(webm []byte) ([]byte, float64, error) {
	a, err := parseWebM(webm)
	if err != nil {
		return nil, 0, err
	}
	head := a.head
	if len(head) < 19 || string(head[:8]) != "OpusHead" {
		head = opusHead(max(a.channels, 1))
	}
	preSkip := int(binary.LittleEndian.Uint16(head[10:]))

	w := &oggWriter{}
	w.page([][]byte{head}, 0, flagBOS)
	w.page([][]byte{opusTags()}, 0, 0)

	granule := uint64(preSkip)
	total := 0
	for i := 0; i < len(a.packets); i += maxPacketsPerPage {
		part := a.packets[i:min(i+maxPacketsPerPage, len(a.packets))]
		for _, p := range part {
			n := opusSamples(p)
			granule += uint64(n)
			total += n
		}
		flags := byte(0)
		if i+maxPacketsPerPage >= len(a.packets) {
			flags = flagEOS
		}
		w.page(part, granule, flags)
	}
	return w.buf.Bytes(), float64(total) / 48000, nil
}
