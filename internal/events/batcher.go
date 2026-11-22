package events

import (
	"sync"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Batcher queues events and flushes them every interval (or once maxItems are waiting), so a
// history sync with thousands of messages doesn't turn into thousands of webview round trips.
// Order is kept, with two merges: back-to-back msg:batch events become one, and a chat:update for
// a chat that's already queued replaces the older snapshot in place.
type Batcher struct {
	out      Emitter
	interval time.Duration
	maxItems int

	mu      sync.Mutex
	queue   []queued
	items   int
	chatIdx map[string]int
	timer   *time.Timer
	closed  bool
}

type queued struct {
	name string
	data any
}

func NewBatcher(out Emitter, interval time.Duration, maxItems int) *Batcher {
	return &Batcher{out: out, interval: interval, maxItems: maxItems, chatIdx: map[string]int{}}
}

func (b *Batcher) Emit(name string, data any) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		b.out.Emit(name, data)
		return
	}
	switch d := data.(type) {
	case domain.MsgBatchEvent:
		if n := len(b.queue); n > 0 && b.queue[n-1].name == MsgBatch {
			prev := b.queue[n-1].data.(domain.MsgBatchEvent)
			prev.Messages = append(prev.Messages, d.Messages...)
			b.queue[n-1].data = prev
		} else {
			b.queue = append(b.queue, queued{name, domain.MsgBatchEvent{Messages: append([]domain.Message(nil), d.Messages...)}})
		}
		b.items += len(d.Messages)
	case domain.ChatUpdateEvent:
		if i, ok := b.chatIdx[d.Chat.JID]; ok {
			b.queue[i].data = d
		} else {
			b.chatIdx[d.Chat.JID] = len(b.queue)
			b.queue = append(b.queue, queued{name, d})
			b.items++
		}
	default:
		b.queue = append(b.queue, queued{name, data})
		b.items++
	}
	if b.items >= b.maxItems {
		batch := b.takeLocked()
		b.mu.Unlock()
		b.send(batch)
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(b.interval, b.Flush)
	}
	b.mu.Unlock()
}

func (b *Batcher) takeLocked() []queued {
	batch := b.queue
	b.queue = nil
	b.items = 0
	clear(b.chatIdx)
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	return batch
}

func (b *Batcher) send(batch []queued) {
	for _, q := range batch {
		b.out.Emit(q.name, q.data)
	}
}

func (b *Batcher) Flush() {
	b.mu.Lock()
	batch := b.takeLocked()
	b.mu.Unlock()
	b.send(batch)
}

// Close flushes and makes later events go straight through.
func (b *Batcher) Close() {
	b.mu.Lock()
	b.closed = true
	batch := b.takeLocked()
	b.mu.Unlock()
	b.send(batch)
}
