import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';

describe('login QR', () => {
  it('encodes a WhatsApp-sized payload into a scannable matrix', () => {
    // the real payload is ref,noiseKey,identityKey,advSecret, around 230 characters
    const code =
      '2@' + 'A'.repeat(120) + ',' + 'B'.repeat(44) + ',' + 'C'.repeat(44) + ',' + 'D'.repeat(44);
    const qr = encode(code, { ecc: 'L', border: 0 });
    expect(qr.size).toBeGreaterThanOrEqual(41);
    // finder pattern in the top-left corner: a solid 7x7 ring
    expect(qr.data[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(qr.data[6].slice(0, 7).every(Boolean)).toBe(true);
    expect(qr.data[1][1]).toBe(false);
  });
});
