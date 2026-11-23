// Package voice turns what the webview records (WebM with Opus inside) into what WhatsApp wants
// for a voice note (Ogg with Opus inside). The audio isn't re-encoded: the Opus packets are moved
// from one container to the other.
package voice

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// EBML element ids we care about. Everything else is skipped by size.
const (
	idSegment      = 0x18538067
	idCluster      = 0x1F43B675
	idTracks       = 0x1654AE6B
	idTrackEntry   = 0xAE
	idCodecID      = 0x86
	idCodecPrivate = 0x63A2
	idAudio        = 0xE1
	idChannels     = 0x9F
	idSimpleBlock  = 0xA3
	idBlockGroup   = 0xA0
	idBlock        = 0xA1
)

// masters are descended into rather than skipped
var masters = map[uint64]bool{idSegment: true, idCluster: true, idTracks: true, idTrackEntry: true, idAudio: true, idBlockGroup: true}

var (
	ErrNotWebM  = errors.New("not a WebM recording")
	ErrNotOpus  = errors.New("the recording isn't Opus audio")
	ErrNoFrames = errors.New("the recording is empty")
)

type webmAudio struct {
	codec    string
	head     []byte // OpusHead from CodecPrivate, if the muxer wrote one
	channels int
	packets  [][]byte
}

// readVint reads an EBML variable-length integer. With keepMarker it's an element id (the
// length marker stays part of the value); otherwise a size, where all ones means "unknown".
func readVint(b []byte, keepMarker bool) (val uint64, n int, unknown bool, err error) {
	if len(b) == 0 {
		return 0, 0, false, ErrNotWebM
	}
	first := b[0]
	length := 1
	for mask := byte(0x80); length <= 8 && first&mask == 0; mask >>= 1 {
		length++
	}
	if length > 8 || len(b) < length {
		return 0, 0, false, ErrNotWebM
	}
	if keepMarker {
		val = uint64(first)
	} else {
		val = uint64(first & (0xFF >> length))
	}
	allOnes := val == uint64(0xFF>>length)
	for i := 1; i < length; i++ {
		val = val<<8 | uint64(b[i])
		allOnes = allOnes && b[i] == 0xFF
	}
	return val, length, allOnes && !keepMarker, nil
}

func parseWebM(data []byte) (*webmAudio, error) {
	if len(data) < 4 || binary.BigEndian.Uint32(data) != 0x1A45DFA3 {
		return nil, ErrNotWebM
	}
	a := &webmAudio{channels: 1}
	var walk func(b []byte) error
	walk = func(b []byte) error {
		for len(b) > 0 {
			id, n, _, err := readVint(b, true)
			if err != nil {
				return err
			}
			size, m, unknown, err := readVint(b[n:], false)
			if err != nil {
				return err
			}
			body := b[n+m:]
			// MediaRecorder streams: the segment and its clusters have "unknown" size and run to
			// the end of the data (or, for clusters, until the next one starts)
			end := len(body)
			if !unknown {
				if size > uint64(len(body)) {
					// a recording cut off mid-element: take what's there
					size = uint64(len(body))
				}
				end = int(size)
			}
			if masters[id] {
				if unknown {
					// children follow inline; parsing them flat is equivalent
					b = body
					continue
				}
				if err := walk(body[:end]); err != nil {
					return err
				}
				b = body[end:]
				continue
			}
			el := body[:end]
			switch id {
			case idCodecID:
				a.codec = string(el)
			case idCodecPrivate:
				a.head = append([]byte(nil), el...)
			case idChannels:
				if len(el) > 0 {
					a.channels = int(el[len(el)-1])
				}
			case idSimpleBlock, idBlock:
				if p, err := blockFrame(el); err == nil && len(p) > 0 {
					a.packets = append(a.packets, p)
				}
			}
			b = body[end:]
		}
		return nil
	}
	if err := walk(data); err != nil && len(a.packets) == 0 {
		return nil, err
	}
	if a.codec != "" && a.codec != "A_OPUS" {
		return nil, fmt.Errorf("%w (%s)", ErrNotOpus, a.codec)
	}
	if len(a.packets) == 0 {
		return nil, ErrNoFrames
	}
	return a, nil
}

// blockFrame is the payload of a (Simple)Block: track number, 16-bit timecode, flags, frame.
// Browsers don't lace Opus, so a laced block is rejected rather than misread.
func blockFrame(el []byte) ([]byte, error) {
	_, n, _, err := readVint(el, false)
	if err != nil || len(el) < n+3 {
		return nil, ErrNotWebM
	}
	flags := el[n+2]
	if flags&0x06 != 0 {
		return nil, errors.New("laced blocks aren't supported")
	}
	return el[n+3:], nil
}
