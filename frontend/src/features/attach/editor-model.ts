// The photo editor's document: a rotation, a crop and a list of drawings, all in the coordinates
// of the rotated, uncropped picture. Nothing is baked until "Done", so undo is a list of states.

export type Tool = 'crop' | 'pen' | 'shape' | 'text' | 'blur';
export type ShapeKind = 'rect' | 'ellipse' | 'arrow' | 'line';
export type Rotation = 0 | 90 | 180 | 270;
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Op =
  // points: x0, y0, x1, y1, ...
  | { t: 'pen'; color: string; width: number; points: number[] }
  | {
      t: 'shape';
      shape: ShapeKind;
      color: string;
      width: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  // x, y: top left of the first line
  | { t: 'text'; color: string; size: number; x: number; y: number; text: string; bg: boolean }
  // strength 1..10
  | { t: 'blur'; mode: 'blur' | 'pixelate'; strength: number; rect: Rect };

export interface EditState {
  rot: Rotation;
  // null = the whole picture
  crop: Rect | null;
  ops: Op[];
}

export const EMPTY: EditState = { rot: 0, crop: null, ops: [] };

export const COLORS = [
  '#ffffff',
  '#1c1c1e',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#0a84ff',
  '#af52de',
];

export const ASPECTS: { label: string; value: number | null | 'original' }[] = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' },
  { label: 'Square', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// line widths and text sizes scale with the picture, so "medium" looks the same on a phone
// screenshot and a 12 MP photo
export function strokeWidth(level: 0 | 1 | 2, W: number, H: number): number {
  const d = Math.hypot(W, H);
  return Math.max([2, 3, 5][level], d * [0.0035, 0.007, 0.014][level]);
}

export function textSize(level: 0 | 1 | 2, W: number, H: number): number {
  const d = Math.hypot(W, H);
  return Math.max([14, 20, 30][level], d * [0.025, 0.04, 0.065][level]);
}

export function rotatedSize(w: number, h: number, rot: Rotation): { W: number; H: number } {
  return rot === 90 || rot === 270 ? { W: h, H: w } : { W: w, H: h };
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

// a quarter turn clockwise of a W×H picture: (x, y) lands on (H - y, x)
const turn = (x: number, y: number, H: number): [number, number] => [H - y, x];

function turnRect(r: Rect, H: number): Rect {
  const [ax, ay] = turn(r.x, r.y, H);
  const [bx, by] = turn(r.x + r.w, r.y + r.h, H);
  return normRect(ax, ay, bx, by);
}

// rotateCW turns the whole document a quarter clockwise; H is its height before the turn
export function rotateCW(s: EditState, H: number): EditState {
  const ops = s.ops.map((op): Op => {
    switch (op.t) {
      case 'pen': {
        const points: number[] = [];
        for (let i = 0; i < op.points.length; i += 2) {
          points.push(...turn(op.points[i], op.points[i + 1], H));
        }
        return { ...op, points };
      }
      case 'shape': {
        const [x1, y1] = turn(op.x1, op.y1, H);
        const [x2, y2] = turn(op.x2, op.y2, H);
        return { ...op, x1, y1, x2, y2 };
      }
      case 'text': {
        // text stays upright; its middle (roughly: the width is a guess) moves with the picture
        const w = op.size * 0.55 * longestLine(op.text);
        const h = op.size * TEXT_LINE * op.text.split('\n').length;
        const [cx, cy] = turn(op.x + w / 2, op.y + h / 2, H);
        return { ...op, x: cx - w / 2, y: cy - h / 2 };
      }
      case 'blur':
        return { ...op, rect: turnRect(op.rect, H) };
    }
  });
  return {
    rot: ((s.rot + 90) % 360) as Rotation,
    crop: s.crop && turnRect(s.crop, H),
    ops,
  };
}

const longestLine = (text: string) => Math.max(1, ...text.split('\n').map((l) => l.length));

// the biggest centred crop with this aspect
export function aspectCrop(W: number, H: number, aspect: number): Rect {
  let w = W;
  let h = W / aspect;
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

// dragging a crop handle by dx, dy (picture pixels); the opposite side stays put
export function resizeCrop(
  s: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  aspect: number | null,
  W: number,
  H: number,
): Rect {
  if (handle === 'move') {
    return { ...s, x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - s.h) };
  }
  const min = Math.max(16, Math.min(W, H) * 0.04);
  const n = handle.includes('n');
  const so = handle.includes('s');
  const e = handle.includes('e');
  const w_ = handle.includes('w');
  let x1 = s.x;
  let y1 = s.y;
  let x2 = s.x + s.w;
  let y2 = s.y + s.h;
  if (w_) x1 = clamp(x1 + dx, 0, x2 - min);
  if (e) x2 = clamp(x2 + dx, x1 + min, W);
  if (n) y1 = clamp(y1 + dy, 0, y2 - min);
  if (so) y2 = clamp(y2 + dy, y1 + min, H);
  if (!aspect) return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };

  let w = x2 - x1;
  let h = y2 - y1;
  const horiz = e || w_;
  const vert = n || so;
  if (horiz && !vert) h = w / aspect;
  else if (vert && !horiz) w = h * aspect;
  else if (w / h > aspect) h = w / aspect;
  else w = h * aspect;

  // the fixed point: the opposite corner or edge (its middle)
  const ax = w_ ? x2 : e ? x1 : (x1 + x2) / 2;
  const ay = n ? y2 : so ? y1 : (y1 + y2) / 2;
  const maxW = w_ ? ax : e ? W - ax : 2 * Math.min(ax, W - ax);
  const maxH = n ? ay : so ? H - ay : 2 * Math.min(ay, H - ay);
  const k = Math.min(1, maxW / w, maxH / h);
  w *= k;
  h *= k;
  return {
    x: w_ ? ax - w : e ? ax : ax - w / 2,
    y: n ? ay - h : so ? ay : ay - h / 2,
    w,
    h,
  };
}

// shift while drawing: squares, circles and lines at 45° steps
export function constrain(op: Extract<Op, { t: 'shape' }>): Extract<Op, { t: 'shape' }> {
  const dx = op.x2 - op.x1;
  const dy = op.y2 - op.y1;
  if (op.shape === 'rect' || op.shape === 'ellipse') {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return { ...op, x2: op.x1 + Math.sign(dx || 1) * d, y2: op.y1 + Math.sign(dy || 1) * d };
  }
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { ...op, x2: op.x1 + Math.cos(a) * len, y2: op.y1 + Math.sin(a) * len };
}

// ---- drawing ----

type Ctx = CanvasRenderingContext2D;

export function drawRotated(src: CanvasImageSource, w: number, h: number, rot: Rotation) {
  const { W, H } = rotatedSize(w, h, rot);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.translate(W / 2, H / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2);
  return c;
}

// the picture with every drawing on top, full size and uncropped
export function compose(ctx: Ctx, base: HTMLCanvasElement, ops: Op[]): void {
  const W = base.width;
  const H = base.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0);
  for (const op of ops) drawOp(ctx, op, W, H);
}

export function drawOp(ctx: Ctx, op: Op, W: number, H: number): void {
  ctx.save();
  switch (op.t) {
    case 'pen':
      strokeStyle(ctx, op.color, op.width);
      ctx.beginPath();
      penPath(ctx, op.points);
      ctx.stroke();
      break;
    case 'shape':
      strokeStyle(ctx, op.color, op.width);
      drawShape(ctx, op);
      break;
    case 'text':
      drawText(ctx, op);
      break;
    case 'blur':
      drawBlur(ctx, op, W, H);
      break;
  }
  ctx.restore();
}

function strokeStyle(ctx: Ctx, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// through the midpoints, so a fast stroke stays smooth instead of turning into a polygon
function penPath(ctx: Ctx, p: number[]) {
  if (p.length < 2) return;
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) {
    ctx.lineTo(p[0] + 0.01, p[1]);
    return;
  }
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
}

function drawShape(ctx: Ctx, op: Extract<Op, { t: 'shape' }>) {
  const { x1, y1, x2, y2 } = op;
  ctx.beginPath();
  switch (op.shape) {
    case 'rect': {
      const r = normRect(x1, y1, x2, y2);
      const radius = Math.min(op.width * 1.5, r.w / 2, r.h / 2);
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      break;
    }
    case 'ellipse': {
      const r = normRect(x1, y1, x2, y2);
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'line':
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      break;
    case 'arrow': {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const head = Math.min(len * 0.5, Math.max(op.width * 4, 12));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
      break;
    }
  }
  ctx.stroke();
}

export const textFont = (size: number) =>
  `600 ${size}px "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif`;
export const TEXT_LINE = 1.25;

// dark text on light colours, white on the rest
export function contrastOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 160 ? '#1c1c1e' : '#ffffff';
}

function drawText(ctx: Ctx, op: Extract<Op, { t: 'text' }>) {
  const lines = op.text.split('\n');
  ctx.font = textFont(op.size);
  ctx.textBaseline = 'top';
  const lh = op.size * TEXT_LINE;
  // the box's padding, also kept without a background so the text lands where it was typed
  const pad = op.size * 0.3;
  if (op.bg) {
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = op.color;
    ctx.beginPath();
    ctx.roundRect(op.x - pad, op.y - pad, w + pad * 2, lh * lines.length + pad * 2, op.size * 0.35);
    ctx.fill();
    ctx.fillStyle = contrastOn(op.color);
  } else {
    // a soft shadow keeps white text readable on a white wall
    ctx.shadowColor = 'rgb(0 0 0 / 0.45)';
    ctx.shadowBlur = op.size * 0.15;
    ctx.fillStyle = op.color;
  }
  lines.forEach((l, i) => ctx.fillText(l, op.x, op.y + i * lh + (lh - op.size) / 2));
}

function drawBlur(ctx: Ctx, op: Extract<Op, { t: 'blur' }>, W: number, H: number) {
  const r = op.rect;
  if (r.w < 1 || r.h < 1) return;
  const d = Math.hypot(W, H);
  // whatever is drawn so far, drawings included, gets blurred
  const snap = document.createElement('canvas');
  snap.width = W;
  snap.height = H;
  snap.getContext('2d')!.drawImage(ctx.canvas, 0, 0);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (op.mode === 'pixelate') {
    const block = Math.max(4, d * 0.003 * op.strength);
    const sw = Math.max(1, Math.round(r.w / block));
    const sh = Math.max(1, Math.round(r.h / block));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    small.getContext('2d')!.drawImage(snap, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    return;
  }
  // strong enough at the default that a phone number or a face is gone, not just soft
  const radius = Math.max(3, d * 0.0042 * op.strength);
  // blurring pulls in transparent pixels at the picture's edges; a copy of the edge behind it
  // keeps the border from going dark
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(snap, -radius * 2, -radius * 2, W + radius * 4, H + radius * 4);
  ctx.drawImage(snap, 0, 0);
}

// bakes everything into a picture: rotated base + drawings, cut to the crop
export function exportCanvas(base: HTMLCanvasElement, s: EditState): HTMLCanvasElement {
  const full = document.createElement('canvas');
  full.width = base.width;
  full.height = base.height;
  compose(full.getContext('2d')!, base, s.ops);
  if (!s.crop) return full;
  const c = s.crop;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w));
  out.height = Math.max(1, Math.round(c.h));
  out.getContext('2d')!.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  return out;
}

export function isEmpty(s: EditState, W: number, H: number): boolean {
  const c = s.crop;
  const fullCrop = !c || (c.x < 0.5 && c.y < 0.5 && c.w > W - 1 && c.h > H - 1);
  return s.rot === 0 && fullCrop && s.ops.length === 0;
}
