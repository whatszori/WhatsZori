package themes

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watch reports changed theme files in dir until ctx is done. Editors save in bursts
// (truncate, write, rename, chmod), so events per file are debounced.
func Watch(ctx context.Context, dir string, debounce time.Duration, onChange func(Changed)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return err
	}

	go func() {
		defer w.Close()
		var mu sync.Mutex
		timers := map[string]*time.Timer{}
		defer func() {
			mu.Lock()
			for _, t := range timers {
				t.Stop()
			}
			mu.Unlock()
		}()

		fire := func(name string) {
			mu.Lock()
			delete(timers, name)
			mu.Unlock()
			if ctx.Err() != nil {
				return
			}
			content, err := os.ReadFile(filepath.Join(dir, name))
			hash := ""
			if err == nil {
				hash = Hash(content)
			}
			onChange(Changed{File: name, Hash: hash})
		}

		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				name := filepath.Base(ev.Name)
				if !IsThemeFile(name) {
					continue
				}
				mu.Lock()
				if t, ok := timers[name]; ok {
					t.Reset(debounce)
				} else {
					timers[name] = time.AfterFunc(debounce, func() { fire(name) })
				}
				mu.Unlock()
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}()
	return nil
}
