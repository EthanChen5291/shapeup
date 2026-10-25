import { describe, expect, test } from 'vitest';
import { parseImageDataUrl, sanitizeOutputName, sniffImageMime } from './imageDataUrl';

function pngDataUrl(width = 1, height = 1) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

describe('image data URL validation', () => {
  test('accepts a bounded PNG data URL and returns dimensions', () => {
    const parsed = parseImageDataUrl(pngDataUrl(320, 240), { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: true,
      mimeType: 'image/png',
      width: 320,
      height: 240,
    });
  });

  test('rejects mismatched declared MIME and image bytes', () => {
    const parsed = parseImageDataUrl('data:image/png;base64,AAAA', { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: false,
      error: 'Invalid or unsupported image data',
    });
  });

  test('rejects oversized dimensions to guard decompression bombs', () => {
    const parsed = parseImageDataUrl(pngDataUrl(9000, 9000), { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: false,
      error: 'Image dimensions are too large',
    });
  });

  test('sanitizes local output names before writing public artifacts', () => {
    expect(sanitizeOutputName('../../public/pwned', 'edit-output')).toBe('edit-output');
    expect(sanitizeOutputName('scan_123-output', 'edit-output')).toBe('scan_123-output');
  });
});

describe('sniffImageMime', () => {
  test('identifies images by magic bytes, not declared type', () => {
    expect(sniffImageMime(Buffer.from(pngDataUrl(2, 2).split(',')[1], 'base64'))).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, ...Buffer.alloc(10)]))).toBe('image/jpeg');
  });

  test('rejects arbitrary bytes', () => {
    expect(sniffImageMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});
