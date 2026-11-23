package notify

import "testing"

type rec struct {
	Nop
	avail bool
	shown []string
	gone  []string
}

func (r *rec) Available() bool      { return r.avail }
func (r *rec) Show(t Toast) error   { r.shown = append(r.shown, t.Body); return nil }
func (r *rec) Withdraw(chat string) { r.gone = append(r.gone, chat) }

func TestSwitch(t *testing.T) {
	sys, own := &rec{avail: true}, &rec{avail: true}
	custom := true
	s := Switch{System: sys, Custom: own, UseCustom: func() bool { return custom }}
	s.Show(Toast{Body: "a"})
	custom = false
	s.Show(Toast{Body: "b"})
	custom, own.avail = true, false
	s.Show(Toast{Body: "c"}) // ours isn't up: fall back to the system
	if len(own.shown) != 1 || len(sys.shown) != 2 {
		t.Fatalf("own %v, system %v", own.shown, sys.shown)
	}
	s.Withdraw("x")
	if len(own.gone) != 1 || len(sys.gone) != 1 {
		t.Error("withdraw must reach both, a chat may have one of each")
	}
}
