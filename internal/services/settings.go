package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/settings"
)

// Keys owned by Go. The frontend can read them but not overwrite them.
const (
	KeyApp    = "app"
	KeyWindow = "window"
)

// "privacy" is ghost mode; it goes through the Privacy service so the gate sees every change
var goOwnedKeys = map[string]bool{KeyWindow: true, "privacy": true}

type Settings struct {
	store *settings.Store
	emit  events.Emitter
}

func NewSettings(store *settings.Store, emit events.Emitter) *Settings {
	return &Settings{store: store, emit: emit}
}

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
	if err := s.store.Set(key, value); err != nil {
		return err
	}
	s.emit.Emit(events.SettingsChanged, domain.SettingsChangedEvent{Key: key})
	return nil
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
