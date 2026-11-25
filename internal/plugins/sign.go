package plugins

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// A plugin can be signed: signature.json next to the manifest holds an Ed25519 public key and a
// signature over every other file in the folder (paths and SHA-256 hashes). WhatsZori checks it
// on every read, so a file changed after signing shows up as "invalid" and the plugin can't run.
// The key is remembered when the user allows the plugin; a later version signed with another key
// has to be allowed again.

const SignatureFile = "signature.json"

const (
	maxSignedFiles = 2000
	maxSignedBytes = 50 << 20
	digestHeader   = "whatszori-plugin-signature-v1\n"
)

type SignatureFileContent struct {
	// base64 of the 32-byte Ed25519 public key
	Key string `json:"key"`
	// base64 of the signature over Digest()
	Sig string `json:"sig"`
}

// Signature is what the app shows.
type Signature struct {
	// unsigned | signed | invalid
	State string `json:"state"`
	// short fingerprint of the key, "ab12 cd34 ef56 7890"
	Key string `json:"key,omitempty"`
	// a publisher WhatsZori knows (the marketplace's keys); empty for everyone else
	Publisher string `json:"publisher,omitempty"`
	// why it's invalid
	Reason string `json:"reason,omitempty"`
}

// Keys of publishers WhatsZori vouches for, by fingerprint. Empty until there's a marketplace.
var TrustedPublishers = map[string]string{}

// Digest is the signed text: a header, then "sha256  path" per file, sorted by path.
func Digest(folder string) ([]byte, error) {
	type entry struct{ rel, sum string }
	var files []entry
	var total int64
	err := filepath.WalkDir(folder, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return errors.New("links aren't allowed in a signed plugin")
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(folder, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == SignatureFile {
			return nil
		}
		if len(files) >= maxSignedFiles {
			return errors.New("too many files to check")
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if total > maxSignedBytes {
			return errors.New("too big to check")
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			return err
		}
		files = append(files, entry{rel, hex.EncodeToString(h.Sum(nil))})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].rel < files[j].rel })
	var b strings.Builder
	b.WriteString(digestHeader)
	for _, f := range files {
		fmt.Fprintf(&b, "%s  %s\n", f.sum, f.rel)
	}
	return []byte(b.String()), nil
}

// Fingerprint is the first 16 hex digits of the key's SHA-256, in groups of four.
func Fingerprint(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	h := hex.EncodeToString(sum[:8])
	return h[0:4] + " " + h[4:8] + " " + h[8:12] + " " + h[12:16]
}

// Sign writes signature.json for folder (used by tests; the SDK's CLI does the same in JS).
func Sign(folder string, priv ed25519.PrivateKey) error {
	d, err := Digest(folder)
	if err != nil {
		return err
	}
	content := SignatureFileContent{
		Key: base64.StdEncoding.EncodeToString(priv.Public().(ed25519.PublicKey)),
		Sig: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, d)),
	}
	data, _ := json.MarshalIndent(content, "", "  ")
	return os.WriteFile(filepath.Join(folder, SignatureFile), append(data, '\n'), 0o644)
}

type sigCacheEntry struct {
	stamp string
	sig   Signature
}

var (
	sigMu    sync.Mutex
	sigCache = map[string]sigCacheEntry{}
)

// Verify checks folder's signature. Results are cached until a file in the folder changes.
func Verify(folder string) Signature {
	raw, err := os.ReadFile(filepath.Join(folder, SignatureFile))
	if errors.Is(err, os.ErrNotExist) {
		return Signature{State: "unsigned"}
	}
	stamp := folderStamp(folder)
	sigMu.Lock()
	if c, ok := sigCache[folder]; ok && c.stamp == stamp && stamp != "" {
		sigMu.Unlock()
		return c.sig
	}
	sigMu.Unlock()

	s := verify(folder, raw, err)
	sigMu.Lock()
	sigCache[folder] = sigCacheEntry{stamp, s}
	sigMu.Unlock()
	return s
}

func verify(folder string, raw []byte, readErr error) Signature {
	bad := func(key, reason string) Signature { return Signature{State: "invalid", Key: key, Reason: reason} }
	if readErr != nil {
		return bad("", "signature.json can't be read")
	}
	var c SignatureFileContent
	if err := json.Unmarshal(raw, &c); err != nil {
		return bad("", "signature.json isn't valid JSON")
	}
	pub, err := base64.StdEncoding.DecodeString(c.Key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return bad("", "the key in signature.json is broken")
	}
	fp := Fingerprint(pub)
	sig, err := base64.StdEncoding.DecodeString(c.Sig)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return bad(fp, "the signature in signature.json is broken")
	}
	d, err := Digest(folder)
	if err != nil {
		return bad(fp, err.Error())
	}
	if !ed25519.Verify(pub, d, sig) {
		return bad(fp, "files were changed after the plugin was signed")
	}
	return Signature{State: "signed", Key: fp, Publisher: TrustedPublishers[fp]}
}

// folderStamp changes when any file in the folder is added, removed, resized or touched
func folderStamp(folder string) string {
	h := sha256.New()
	n := 0
	_ = filepath.WalkDir(folder, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if n++; n > maxSignedFiles {
			return fs.SkipAll
		}
		if info, err := d.Info(); err == nil {
			fmt.Fprintf(h, "%s|%d|%d\n", p, info.Size(), info.ModTime().UnixNano())
		}
		return nil
	})
	return hex.EncodeToString(h.Sum(nil))
}
