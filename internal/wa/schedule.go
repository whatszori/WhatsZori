package wa

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Scheduled messages: one message, one chat, one time, set by hand. They go out through
// SendText like anything typed, so the rate limit and the rest apply. If WhatsZori wasn't
// running (or was offline) at the time, it sends once it's back, unless it's more than
// MissedAfter late; those wait for "send now" or delete, so a "good morning" doesn't arrive
// three days later.

const (
	evScheduled  = "scheduled:changed"
	scheduleTick = 15 * time.Second
	MissedAfter  = 12 * time.Hour
	// how far ahead a message can be scheduled
	maxAhead = 366 * 24 * time.Hour
)

var ErrPast = errors.New("pick a time in the future")

type Scheduler struct {
	S    *Sender
	wake chan struct{}
	once sync.Once
	mu   sync.Mutex
	// a failed send is retried after this, not every tick
	retry map[int64]time.Time
}

func (sc *Scheduler) init() {
	sc.once.Do(func() {
		sc.wake = make(chan struct{}, 1)
		sc.retry = map[int64]time.Time{}
	})
}

// Run sends due messages until ctx ends.
func (sc *Scheduler) Run(ctx context.Context) {
	sc.init()
	t := time.NewTicker(scheduleTick)
	defer t.Stop()
	for {
		sc.Tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-sc.wake:
		}
	}
}

func (sc *Scheduler) poke() {
	sc.init()
	select {
	case sc.wake <- struct{}{}:
	default:
	}
}

// Tick sends what's due now.
func (sc *Scheduler) Tick(ctx context.Context) {
	sc.init()
	s := sc.S
	if _, err := s.Ready(); err != nil {
		return // offline: they wait
	}
	now := s.now()
	due, err := repo.DueScheduled(ctx, s.DB, now.UnixMilli())
	if err != nil {
		s.log().Error("due scheduled", "error", err)
		return
	}
	for _, r := range due {
		sc.mu.Lock()
		wait := sc.retry[r.ID]
		sc.mu.Unlock()
		if now.Before(wait) {
			continue
		}
		if now.Sub(time.UnixMilli(r.SendAt)) > MissedAfter {
			if !strings.HasPrefix(r.Error, "Missed") {
				msg := "Missed: WhatsZori wasn't running or online at " + time.UnixMilli(r.SendAt).Format("Jan 2, 15:04")
				_ = repo.SetScheduledError(ctx, s.DB, r.ID, msg)
				sc.changed(r.ChatJID)
			}
			continue
		}
		_ = sc.send(ctx, r)
	}
}

func (sc *Scheduler) send(ctx context.Context, r repo.ScheduledRow) error {
	s := sc.S
	_, err := s.SendText(ctx, r.ChatJID, r.Body, r.ReplyTo, r.Mentions...)
	if err != nil && r.ReplyTo != 0 && errors.Is(err, repo.ErrNotFound) {
		// the message it answered is gone: send it on its own
		_, err = s.SendText(ctx, r.ChatJID, r.Body, 0, r.Mentions...)
	}
	if err != nil {
		s.log().Warn("scheduled send", "id", r.ID, "error", redact.Digits(err.Error()))
		sc.mu.Lock()
		sc.retry[r.ID] = s.now().Add(time.Minute)
		sc.mu.Unlock()
		_ = repo.SetScheduledError(ctx, s.DB, r.ID, "Not sent yet: "+err.Error())
		sc.changed(r.ChatJID)
		return err
	}
	sc.mu.Lock()
	delete(sc.retry, r.ID)
	sc.mu.Unlock()
	_ = repo.DeleteScheduled(ctx, s.DB, r.ID)
	sc.changed(r.ChatJID)
	return nil
}

func (sc *Scheduler) changed(chat string) {
	sc.S.Emit.Emit(evScheduled, domain.ScheduledChangedEvent{ChatJID: chat})
}

func scheduledDTO(r repo.ScheduledRow) domain.ScheduledMessage {
	d := domain.ScheduledMessage{ID: strconv.FormatInt(r.ID, 10), ChatJID: r.ChatJID, Text: r.Body, SendAt: r.SendAt, Error: r.Error}
	if r.ReplyTo != 0 {
		d.ReplyToPK = strconv.FormatInt(r.ReplyTo, 10)
	}
	return d
}

// Schedule keeps a text message to send at sendAt (ms).
func (sc *Scheduler) Schedule(ctx context.Context, chat, text string, sendAt, replyTo int64, mentions []string) (domain.ScheduledMessage, error) {
	s := sc.S
	text = strings.TrimRight(text, " \t\r\n")
	if strings.TrimSpace(text) == "" {
		return domain.ScheduledMessage{}, ErrEmpty
	}
	if utf8.RuneCountInString(text) > maxTextRunes {
		return domain.ScheduledMessage{}, ErrTooLong
	}
	if err := sc.checkTime(sendAt); err != nil {
		return domain.ScheduledMessage{}, err
	}
	if _, err := ForSend(chat); err != nil {
		return domain.ScheduledMessage{}, fmt.Errorf("bad chat: %w", err)
	}
	r := repo.ScheduledRow{ChatJID: chat, Body: text, Mentions: mentionsIn(chat, text, mentions), ReplyTo: replyTo,
		SendAt: sendAt, CreatedAt: s.now().UnixMilli()}
	if err := repo.EnsureChat(ctx, s.DB, chat, strings.HasSuffix(chat, "@g.us")); err != nil {
		return domain.ScheduledMessage{}, err
	}
	id, err := repo.AddScheduled(ctx, s.DB, r)
	if err != nil {
		return domain.ScheduledMessage{}, err
	}
	r.ID = id
	sc.changed(chat)
	sc.poke()
	return scheduledDTO(r), nil
}

func (sc *Scheduler) checkTime(sendAt int64) error {
	now := sc.S.now()
	at := time.UnixMilli(sendAt)
	if !at.After(now) {
		return ErrPast
	}
	if at.Sub(now) > maxAhead {
		return errors.New("pick a time within a year")
	}
	return nil
}

func (sc *Scheduler) List(ctx context.Context, chat string) ([]domain.ScheduledMessage, error) {
	rows, err := repo.ListScheduled(ctx, sc.S.DB, chat)
	if err != nil {
		return nil, err
	}
	out := make([]domain.ScheduledMessage, 0, len(rows))
	for _, r := range rows {
		out = append(out, scheduledDTO(r))
	}
	return out, nil
}

// Update changes a scheduled message's text and time.
func (sc *Scheduler) Update(ctx context.Context, id int64, text string, sendAt int64) error {
	sc.init()
	r, err := repo.GetScheduled(ctx, sc.S.DB, id)
	if errors.Is(err, repo.ErrNotFound) {
		return repo.ErrNotScheduled
	} else if err != nil {
		return err
	}
	text = strings.TrimRight(text, " \t\r\n")
	if strings.TrimSpace(text) == "" {
		return ErrEmpty
	}
	if err := sc.checkTime(sendAt); err != nil {
		return err
	}
	sc.mu.Lock()
	delete(sc.retry, id)
	sc.mu.Unlock()
	if err := repo.UpdateScheduled(ctx, sc.S.DB, id, text, sendAt); err != nil {
		return err
	}
	sc.changed(r.ChatJID)
	sc.poke()
	return nil
}

func (sc *Scheduler) Delete(ctx context.Context, id int64) error {
	r, err := repo.GetScheduled(ctx, sc.S.DB, id)
	if errors.Is(err, repo.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if err := repo.DeleteScheduled(ctx, sc.S.DB, id); err != nil {
		return err
	}
	sc.changed(r.ChatJID)
	return nil
}

// SendNow sends a scheduled message right away.
func (sc *Scheduler) SendNow(ctx context.Context, id int64) error {
	sc.init()
	r, err := repo.GetScheduled(ctx, sc.S.DB, id)
	if errors.Is(err, repo.ErrNotFound) {
		return repo.ErrNotScheduled
	} else if err != nil {
		return err
	}
	return sc.send(ctx, r)
}
