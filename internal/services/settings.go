package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/whatszori/WhatsZori/internal/settings"
)

// Keys owned by Go. The frontend can read them but not overwrite them.
const (
	KeyApp    = "app"
	KeyWindow = "window"
)

var goOwnedKeys = map[string]bool{KeyWindow: true}

type Settings struct {
	store *settings.Store
}

func NewSettings(store *settings.Store) *Settings { return &Settings{store: store} }

// Get returns the stored value, or null when the key was never set.
func (s *Settings) Get(key string) (any, error) {
	raw, ok := s.store.Get(key)
	if !ok {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return v, nil
}

func (s *Settings) Set(key string, value any) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("empty settings key")
	}
	if goOwnedKeys[key] {
		return fmt.Errorf("settings key %q is managed by the app", key)
	}
	return s.store.Set(key, value)
}

func (s *Settings) GetAll() (map[string]any, error) {
	out := map[string]any{}
	for k, raw := range s.store.All() {
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		out[k] = v
	}
	return out, nil
}
