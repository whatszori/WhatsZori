import { describe, expect, it } from 'vitest';
import {
  aspectCrop,
  constrain,
  isEmpty,
  resizeCrop,
  rotateCW,
  rotatedSize,
  type EditState,
} from './editor-model';

describe('resizeCrop', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('moves inside the picture', () => {
    expect(resizeCrop(box, 'move', 1000, -1000, null, 800, 600)).toEqual({
      x: 600,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  it('drags one edge and keeps the other', () => {
    expect(resizeCrop(box, 'e', 50, 0, null, 800, 600)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeCrop(box, 'nw', -500, -500, null, 800, 600)).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 200,
    });
  });

  it("doesn't turn inside out", () => {
    const r = resizeCrop(box, 'w', 1000, 0, null, 800, 600);
    expect(r.w).toBeGreaterThanOrEqual(16);
    expect(r.x + r.w).toBe(300);
  });

  it('keeps the ratio and the opposite corner, and stays in the picture', () => {
    const r = resizeCrop({ x: 100, y: 100, w: 200, h: 200 }, 'se', 1000, 10, 1, 800, 600);
    expect(r.w).toBeCloseTo(r.h);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    expect(r.y + r.h).toBeLessThanOrEqual(600);
  });
});

describe('aspectCrop', () => {
  it('is the biggest centred frame', () => {
    expect(aspectCrop(800, 600, 1)).toEqual({ x: 100, y: 0, w: 600, h: 600 });
    expect(aspectCrop(800, 600, 16 / 9)).toEqual({ x: 0, y: 75, w: 800, h: 450 });
  });
});

describe('rotateCW', () => {
  const doc: EditState = {
    rot: 0,
    crop: { x: 10, y: 20, w: 300, h: 100 },
    ops: [
      { t: 'pen', color: '#fff', width: 4, points: [1, 2, 30, 40] },
      { t: 'shape', shape: 'arrow', color: '#fff', width: 4, x1: 5, y1: 6, x2: 70, y2: 80 },
      { t: 'text', color: '#fff', size: 20, x: 50, y: 60, text: 'hi\nthere', bg: false },
      { t: 'blur', mode: 'blur', strength: 5, rect: { x: 0, y: 0, w: 40, h: 20 } },
    ],
  };

  it('turns the frame with the picture', () => {
    // 800×600: the top-left corner ends up on the right edge
    const r = rotateCW(doc, 600);
    expect(r.rot).toBe(90);
    expect(r.crop).toEqual({ x: 480, y: 10, w: 100, h: 300 });
    expect(r.ops[0]).toMatchObject({ points: [598, 1, 560, 30] });
  });

  it('comes back after four turns', () => {
    let s = doc;
    let { W, H } = { W: 800, H: 600 };
    for (let i = 0; i < 4; i++) {
      s = rotateCW(s, H);
      ({ W, H } = rotatedSize(800, 600, s.rot));
    }
    expect(W).toBe(800);
    expect(s.rot).toBe(0);
    expect(s.crop).toEqual(doc.crop);
    for (const [i, op] of s.ops.entries()) {
      const want = doc.ops[i];
      if (op.t === 'text' && want.t === 'text') {
        expect(op.x).toBeCloseTo(want.x);
        expect(op.y).toBeCloseTo(want.y);
      } else expect(op).toEqual(want);
    }
  });
});

describe('constrain', () => {
  it('makes squares and 45° lines', () => {
    const sq = constrain({
      t: 'shape',
      shape: 'rect',
      color: '',
      width: 1,
      x1: 0,
      y1: 0,
      x2: 30,
      y2: -10,
    });
    expect([sq.x2, sq.y2]).toEqual([30, -30]);
    const ln = constrain({
      t: 'shape',
      shape: 'line',
      color: '',
      width: 1,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 10,
    });
    expect(ln.y2).toBeCloseTo(0);
  });
});

describe('isEmpty', () => {
  it('ignores a crop of the whole picture', () => {
    expect(isEmpty({ rot: 0, crop: { x: 0, y: 0, w: 800, h: 600 }, ops: [] }, 800, 600)).toBe(true);
    expect(isEmpty({ rot: 90, crop: null, ops: [] }, 600, 800)).toBe(false);
  });
});
