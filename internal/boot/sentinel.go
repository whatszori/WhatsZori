package boot

import (
	"errors"
	"io/fs"
	"os"
	"strconv"
	"sync"
	"time"
)

// Sentinel detects starts that never got far enough for the frontend to call OK.
// Begin writes a marker file and OK removes it; finding the marker on the next start means the
// last one crashed or hung, so that start runs in safe mode.
type Sentinel struct {
	path   string
	forced bool

	mu     sync.Mutex
	safe   bool
	begun  bool
	okOnce sync.Once
}

func New(path string, forceSafe bool) *Sentinel {
	return &Sentinel{path: path, forced: forceSafe}
}

// Begin must only run in the instance that actually starts. A second launch that just hands
// over to the running window would otherwise leave a marker behind.
func (s *Sentinel) Begin() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.begun {
		return
	}
	s.begun = true
	if _, err := os.Stat(s.path); err == nil {
		s.safe = true
	}
	_ = os.WriteFile(s.path, []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o644)
}

func (s *Sentinel) SafeMode() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.safe || s.forced
}

// Recovered is true when safe mode comes from a failed previous start rather than the flag.
func (s *Sentinel) Recovered() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.safe
}

func (s *Sentinel) OK() error {
	var err error
	s.okOnce.Do(func() {
		err = os.Remove(s.path)
		if errors.Is(err, fs.ErrNotExist) {
			err = nil
		}
	})
	return err
}
