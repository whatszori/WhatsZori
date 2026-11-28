package wa_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

func TestScheduler(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	now := time.Date(2026, 11, 28, 9, 0, 0, 0, time.UTC)
	e.s.Now = func() time.Time { return now }
	sc := &wa.Scheduler{S: e.s}

	if _, err := sc.Schedule(ctx, alice.String(), "too late", now.Add(-time.Minute).UnixMilli(), 0, nil); err == nil {
		t.Fatal("a time in the past was accepted")
	}
	m, err := sc.Schedule(ctx, alice.String(), "good morning", now.Add(time.Hour).UnixMilli(), 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	missed, err := sc.Schedule(ctx, alice.String(), "missed one", now.Add(30*time.Minute).UnixMilli(), 0, nil)
	if err != nil {
		t.Fatal(err)
	}

	sc.Tick(ctx)
	if len(e.cli.sent) != 0 {
		t.Fatal("sent before its time")
	}

	// 14 hours later (the app was off): both are more than 12 hours late
	now = now.Add(14 * time.Hour)
	sc.Tick(ctx)
	if len(e.cli.sent) != 0 {
		t.Fatalf("sent %d missed messages", len(e.cli.sent))
	}
	list, _ := sc.List(ctx, alice.String())
	if len(list) != 2 || !strings.HasPrefix(list[0].Error, "Missed") {
		t.Fatalf("missed not marked: %+v", list)
	}
	// "send now" still works for a missed one
	if err := sc.SendNow(ctx, mustID(t, missed.ID)); err != nil {
		t.Fatal(err)
	}
	if len(e.cli.sent) != 1 || e.cli.sent[0].msg.GetConversation() != "missed one" {
		t.Fatalf("send now: %d", len(e.cli.sent))
	}

	// moved to a new time, it goes out when that comes
	if err := sc.Update(ctx, mustID(t, m.ID), "good evening", now.Add(time.Minute).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute)
	sc.Tick(ctx)
	if len(e.cli.sent) != 2 || e.cli.sent[1].msg.GetConversation() != "good evening" {
		t.Fatalf("rescheduled not sent: %d", len(e.cli.sent))
	}
	if rows, _ := repo.ListScheduled(ctx, e.db, ""); len(rows) != 0 {
		t.Fatalf("sent ones still listed: %d", len(rows))
	}
}

func mustID(t *testing.T, s string) int64 {
	t.Helper()
	var n int64
	for _, c := range s {
		n = n*10 + int64(c-'0')
	}
	return n
}
