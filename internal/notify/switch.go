package notify

import (
	"context"
	"errors"
)

// Switch sends each notification either to the system or to WhatsZori's own toast window,
// whichever the user picked. Both stay started, so switching takes effect on the next one.
type Switch struct {
	System Desktop
	Custom Desktop
	// UseCustom is read per notification
	UseCustom func() bool
}

func (s Switch) pick() Desktop {
	if s.Custom != nil && s.UseCustom != nil && s.UseCustom() && s.Custom.Available() {
		return s.Custom
	}
	return s.System
}

func (s Switch) Start(ctx context.Context) error {
	var errs []error
	for _, d := range []Desktop{s.System, s.Custom} {
		if d != nil {
			errs = append(errs, d.Start(ctx))
		}
	}
	return errors.Join(errs...)
}

func (s Switch) Show(t Toast) error { return s.pick().Show(t) }

func (s Switch) Withdraw(chat string) {
	for _, d := range []Desktop{s.System, s.Custom} {
		if d != nil {
			d.Withdraw(chat)
		}
	}
}

func (s Switch) OnResponse(fn func(Response)) {
	for _, d := range []Desktop{s.System, s.Custom} {
		if d != nil {
			d.OnResponse(fn)
		}
	}
}

func (s Switch) Available() bool { return s.pick().Available() }

func (s Switch) Close() {
	for _, d := range []Desktop{s.System, s.Custom} {
		if d != nil {
			d.Close()
		}
	}
}
