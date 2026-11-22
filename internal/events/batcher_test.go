package events

import (
	"sync"
	"testing"
	"time"

	"github.com/whatszori/WhatsZori/internal/domain"
)

type recorder struct {
	mu  sync.Mutex
	got []queued
}

func (r *recorder) Emit(name string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, queued{name, data})
}

func (r *recorder) snapshot() []queued {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]queued(nil), r.got...)
}

func msgs(pks ...string) domain.MsgBatchEvent {
	var out domain.MsgBatchEvent
	for _, pk := range pks {
		out.Messages = append(out.Messages, domain.Message{PK: pk})
	}
	return out
}

func TestBatcherMergesAndKeepsOrder(t *testing.T) {
	r := &recorder{}
	b := NewBatcher(r, time.Hour, 1000)
	b.Emit(MsgBatch, msgs("1"))
	b.Emit(MsgBatch, msgs("2", "3"))
	b.Emit(ChatUpdate, domain.ChatUpdateEvent{Chat: domain.Chat{JID: "a", Unread: 1}})
	b.Emit(MsgEdited, domain.MsgEditedEvent{PK: "1"})
	b.Emit(ChatUpdate, domain.ChatUpdateEvent{Chat: domain.Chat{JID: "a", Unread: 2}})
	b.Emit(MsgBatch, msgs("4"))
	if len(r.snapshot()) != 0 {
		t.Fatal("emitted before flush")
	}
	b.Flush()
	got := r.snapshot()
	if len(got) != 4 {
		t.Fatalf("got %d events, want 4: %+v", len(got), got)
	}
	if got[0].name != MsgBatch || len(got[0].data.(domain.MsgBatchEvent).Messages) != 3 {
		t.Errorf("first batch not merged: %+v", got[0])
	}
	if got[1].name != ChatUpdate || got[1].data.(domain.ChatUpdateEvent).Chat.Unread != 2 {
		t.Errorf("chat update not replaced with the latest snapshot: %+v", got[1])
	}
	if got[2].name != MsgEdited || got[3].name != MsgBatch {
		t.Errorf("order changed: %s, %s", got[2].name, got[3].name)
	}
}

func TestBatcherFlushesWhenFull(t *testing.T) {
	r := &recorder{}
	b := NewBatcher(r, time.Hour, 3)
	b.Emit(MsgBatch, msgs("1", "2"))
	b.Emit(MsgBatch, msgs("3"))
	if n := len(r.snapshot()); n != 1 {
		t.Fatalf("got %d events after hitting the limit, want 1", n)
	}
}

func TestBatcherFlushesOnTimer(t *testing.T) {
	r := &recorder{}
	b := NewBatcher(r, 10*time.Millisecond, 100)
	b.Emit(Toast, domain.ToastEvent{Text: "x"})
	deadline := time.Now().Add(2 * time.Second)
	for len(r.snapshot()) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(r.snapshot()) != 1 {
		t.Fatal("timer flush didn't happen")
	}
}
