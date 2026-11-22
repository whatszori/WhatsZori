package app

const (
	MinWidth      = 900
	MinHeight     = 600
	DefaultWidth  = 1200
	DefaultHeight = 780
)

type rect struct{ X, Y, W, H int }

func intersect(a, b rect) rect {
	x1, y1 := max(a.X, b.X), max(a.Y, b.Y)
	x2, y2 := min(a.X+a.W, b.X+b.W), min(a.Y+a.H, b.Y+b.H)
	if x2 <= x1 || y2 <= y1 {
		return rect{}
	}
	return rect{x1, y1, x2 - x1, y2 - y1}
}

// reachable is true when enough of the window's title bar is on some screen to grab it.
// A window that's merely touching a screen edge (or left on a monitor that's gone) is not.
func reachable(win rect, screens []rect) bool {
	if win.W <= 0 || win.H <= 0 {
		return false
	}
	titleBar := rect{win.X, win.Y, win.W, min(40, win.H)}
	for _, s := range screens {
		if hit := intersect(titleBar, s); hit.W >= 120 && hit.H >= 20 {
			return true
		}
	}
	return false
}

// fitSize keeps the window within the min size and the largest screen's work area.
func fitSize(w, h int, screens []rect) (int, int) {
	if w <= 0 || h <= 0 {
		w, h = DefaultWidth, DefaultHeight
	}
	maxW, maxH := 0, 0
	for _, s := range screens {
		maxW, maxH = max(maxW, s.W), max(maxH, s.H)
	}
	if maxW > 0 {
		w, h = min(w, maxW), min(h, maxH)
	}
	return max(w, MinWidth), max(h, MinHeight)
}
