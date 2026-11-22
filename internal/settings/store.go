package settings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Store is a small JSON key-value file. Each top-level key belongs to one owner
// ("app" is the frontend's AppSettings, "window" is the window state, and so on).
type Store struct {
	path string
	mu   sync.Mutex
	data map[string]json.RawMessage
}

func Open(path string) (*Store, error) {
	s := &Store{path: path, data: map[string]json.RawMessage{}}
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read settings: %w", err)
	}
	// Notepad and PowerShell like to add a BOM when someone edits the file by hand
	raw = bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
	if err := json.Unmarshal(raw, &s.data); err != nil {
		// keep the broken file around so nothing is silently lost, then start fresh
		bad := fmt.Sprintf("%s.broken-%d", path, time.Now().Unix())
		_ = os.Rename(path, bad)
		s.data = map[string]json.RawMessage{}
	}
	return s, nil
}

func (s *Store) Path() string { return s.path }

func (s *Store) Get(key string) (json.RawMessage, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[key]
	return v, ok
}

// Decode unmarshals the key into v. It reports false if the key is missing or doesn't fit v.
func (s *Store) Decode(key string, v any) bool {
	raw, ok := s.Get(key)
	if !ok {
		return false
	}
	return json.Unmarshal(raw, v) == nil
}

func (s *Store) All() map[string]json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return maps.Clone(s.data)
}

func (s *Store) Set(key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("encode %q: %w", key, err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[key] = raw
	return s.saveLocked()
}

func (s *Store) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[key]; !ok {
		return nil
	}
	delete(s.data, key)
	return s.saveLocked()
}

func (s *Store) saveLocked() error {
	out, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(s.path, out)
}

// WriteFileAtomic writes to a temp file next to path and renames it over, so a crash mid-write
// leaves either the old file or the new one, never half of each.
func WriteFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	// os.Rename replaces an existing file on Windows too (MoveFileEx with REPLACE_EXISTING)
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return err
	}
	return nil
}
