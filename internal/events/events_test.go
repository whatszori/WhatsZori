package events

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The TS side hand-writes the same names; catch drift before it turns into a silent no-op.
func TestNamesMatchFrontend(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "frontend", "src", "api", "events.ts"))
	if err != nil {
		t.Fatalf("read events.ts: %v", err)
	}
	for _, name := range All {
		if !strings.Contains(string(src), "'"+name+"'") {
			t.Errorf("event %q is missing from frontend/src/api/events.ts", name)
		}
	}
	// and the other way: every name in the TS const maps has a Go constant
	re := regexp.MustCompile(`(?m)^\s+\w+: '([a-z:]+)',$`)
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		if !slices.Contains(All, m[1]) {
			t.Errorf("events.ts has %q, which Go doesn't emit", m[1])
		}
	}
}
