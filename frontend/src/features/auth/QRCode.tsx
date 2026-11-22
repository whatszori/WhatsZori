import { useMemo } from 'react';
import { encode } from 'uqr';

const QUIET = 2;

// One <path> for all dark modules instead of a rect per module: a WA login code is ~1600 modules.
export function QRCode({ code, size = 224 }: { code: string; size?: number }) {
  const { n, d } = useMemo(() => {
    // ecc L keeps the code small enough to scan from a laptop screen; WA's own web client does the same
    const qr = encode(code, { ecc: 'L', border: 0 });
    let path = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { n: qr.size, d: path };
  }, [code]);

  return (
    <svg
      className="wz-qr"
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${n + QUIET * 2} ${n + QUIET * 2}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect
        x={-QUIET}
        y={-QUIET}
        width={n + QUIET * 2}
        height={n + QUIET * 2}
        className="wz-qr__bg"
      />
      <path d={d} className="wz-qr__cell" />
    </svg>
  );
}
