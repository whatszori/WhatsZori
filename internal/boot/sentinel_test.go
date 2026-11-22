package boot

import (
	"os"
	"path/filepath"
	"testing"
)

func start(path string, force bool) *Sentinel {
	s := New(path, force)
	s.Begin()
	return s
}

func TestSentinel(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "boot.pending")

	first := start(marker, false)
	if first.SafeMode() {
		t.Fatal("first start should be normal")
	}

	// first start never reached OK
	second := start(marker, false)
	if !second.SafeMode() || !second.Recovered() {
		t.Fatal("start after a failed one should be safe mode")
	}
	if err := second.OK(); err != nil {
		t.Fatal(err)
	}

	third := start(marker, false)
	if third.SafeMode() {
		t.Fatal("start after OK should be normal")
	}

	if forced := start(filepath.Join(t.TempDir(), "x"), true); !forced.SafeMode() || forced.Recovered() {
		t.Fatal("flag should force safe mode")
	}
}

func TestNewHasNoSideEffects(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "boot.pending")
	// a second instance constructs one and exits before Begin
	_ = New(marker, false)
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("New must not write the marker")
	}
}
