package plugins

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watch calls onChange(id) when anything in a plugin's folder changes, debounced per plugin, so
// `wz-plugin dev` rebuilding a file restarts the plugin without the user touching anything.
func Watch(ctx context.Context, dir string, debounce time.Duration, onChange func(id string)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return err
	}
	addTree := func(root string) {
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || !d.IsDir() {
				return nil
			}
			if p != root && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules") {
				return filepath.SkipDir
			}
			_ = w.Add(p)
			return nil
		})
	}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				addTree(filepath.Join(dir, e.Name()))
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
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				rel, err := filepath.Rel(dir, ev.Name)
				if err != nil || rel == "." {
					continue
				}
				id, _, _ := strings.Cut(filepath.ToSlash(rel), "/")
				if ev.Has(fsnotify.Create) {
					if st, err := os.Stat(ev.Name); err == nil && st.IsDir() {
						addTree(ev.Name)
					}
				}
				mu.Lock()
				if t, ok := timers[id]; ok {
					t.Reset(debounce)
				} else {
					timers[id] = time.AfterFunc(debounce, func() {
						mu.Lock()
						delete(timers, id)
						mu.Unlock()
						if ctx.Err() == nil {
							onChange(id)
						}
					})
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
