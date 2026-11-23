package themes

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() && IsPackageDir(e.Name()) {
				_ = w.Add(filepath.Join(dir, e.Name()))
			}
		}
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
			content, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
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
				rel, err := filepath.Rel(dir, ev.Name)
				if err != nil {
					continue
				}
				name := filepath.ToSlash(rel)
				base := filepath.Base(ev.Name)
				// a new package folder: follow it too
				if ev.Has(fsnotify.Create) && !strings.Contains(name, "/") && IsPackageDir(base) {
					if st, err := os.Stat(ev.Name); err == nil && st.IsDir() {
						_ = w.Add(ev.Name)
						continue
					}
				}
				inPackage := strings.Count(name, "/") == 1 && IsPackageDir(strings.Split(name, "/")[0])
				if !IsThemeFile(base) && !(inPackage && base == "manifest.json") {
					continue
				}
				if strings.Contains(name, "/") && !inPackage {
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
