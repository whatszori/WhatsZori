package app

import "testing"

func TestReachable(t *testing.T) {
	primary := rect{0, 0, 1920, 1040}
	left := rect{-1280, 0, 1280, 984}
	screens := []rect{primary, left}

	cases := []struct {
		name string
		win  rect
		want bool
	}{
		{"centered", rect{300, 200, 1200, 780}, true},
		{"on the left monitor", rect{-1200, 100, 1000, 700}, true},
		{"monitor unplugged", rect{3000, 100, 1000, 700}, false},
		{"title bar above the screen", rect{100, -500, 1000, 480}, false},
		{"only a sliver visible", rect{1860, 100, 1000, 700}, false},
		{"mostly off the right edge but grabbable", rect{1700, 100, 1000, 700}, true},
		{"empty", rect{}, false},
	}
	for _, c := range cases {
		if got := reachable(c.win, screens); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestFitSize(t *testing.T) {
	screens := []rect{{0, 0, 1366, 728}}
	if w, h := fitSize(2000, 1400, screens); w != 1366 || h != 728 {
		t.Errorf("too big: %dx%d", w, h)
	}
	if w, h := fitSize(400, 300, screens); w != MinWidth || h != MinHeight {
		t.Errorf("too small: %dx%d", w, h)
	}
	if w, h := fitSize(0, 0, nil); w != DefaultWidth || h != DefaultHeight {
		t.Errorf("default: %dx%d", w, h)
	}
}
