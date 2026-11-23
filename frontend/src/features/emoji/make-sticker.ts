const SIZE = 512;
// WhatsApp's own maker keeps static stickers around 100 KB; aim a bit above for quality
const TARGET = 300 * 1024;

// Turns a picture into a 512×512 sticker in the page: lossy WebP where the webview can encode it
// (WebView2, Chromium). Elsewhere (WebKitGTK) it comes out as PNG and Go converts it.
export async function makeSticker(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const scale = Math.min(SIZE / bmp.width, SIZE / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  bmp.close();

  const toBlob = (type: string, q?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    const b = await toBlob('image/webp', q);
    if (!b || b.type !== 'image/webp') break;
    if (b.size <= TARGET) return b;
  }
  const png = await toBlob('image/png');
  if (!png) throw new Error('Could not make the sticker');
  return png;
}
