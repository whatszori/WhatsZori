package events

import (
	"os"
	"path/filepath"
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
}
