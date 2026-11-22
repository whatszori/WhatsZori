import { useMemo } from 'react';
import { createRng } from '../../lib/rng';
import { hashString } from '../../lib/format';

const SIZE = 29;

function isFinder(x: number, y: number): boolean {
  const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  return inBox(0, 0) || inBox(SIZE - 7, 0) || inBox(0, SIZE - 7);
}

function finderCell(x: number, y: number): boolean {
  const lx = x >= SIZE - 7 ? x - (SIZE - 7) : x;
  const ly = y >= SIZE - 7 ? y - (SIZE - 7) : y;
  const edge = lx === 0 || lx === 6 || ly === 0 || ly === 6;
  const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
  return edge || core;
}

// Looks like a QR code, isn't one. The real one gets rendered from the whatsmeow payload later.
export function FakeQR({ code, size = 224 }: { code: string; size?: number }) {
  const cells = useMemo(() => {
    const rng = createRng(hashString(code));
    const out: [number, number][] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const on = isFinder(x, y) ? finderCell(x, y) : rng.chance(0.47);
        // keep a quiet ring around the finder patterns
        const nearFinder =
          !isFinder(x, y) &&
          ((x <= 7 && y <= 7) || (x >= SIZE - 8 && y <= 7) || (x <= 7 && y >= SIZE - 8));
        if (on && !nearFinder) out.push([x, y]);
      }
    }
    return out;
  }, [code]);

  return (
    <svg
      className="wz-qr"
      width={size}
      height={size}
      viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x={-2} y={-2} width={SIZE + 4} height={SIZE + 4} className="wz-qr__bg" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className="wz-qr__cell" />
      ))}
    </svg>
  );
}
