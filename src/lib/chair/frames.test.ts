// @vitest-environment jsdom

// The two pure measurements behind the reference sheet. The sign convention on
// yaw in particular is worth pinning: get it backwards and every sheet comes
// out mirrored — left profiles filed as right ones — which is exactly the kind
// of error a barber only discovers mid-haircut.

import { describe, expect, test } from 'vitest';
import { laplacianVariance, yawFromMatrix } from './frames';

/**
 * A column-major 4×4 rotation about the vertical axis, in MediaPipe's layout
 * (x right, y up, z toward the viewer). Its third column is the face's forward
 * vector, which is what yawFromMatrix reads.
 */
function yRotation(degrees: number) {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // prettier-ignore
  const data = [
    c, 0, -s, 0,   // column 0
    0, 1,  0, 0,   // column 1
    s, 0,  c, 0,   // column 2 — the forward vector
    0, 0,  0, 1,   // column 3
  ];
  return { rows: 4, columns: 4, data };
}

describe('yawFromMatrix', () => {
  test('a head facing the camera reads as zero', () => {
    expect(yawFromMatrix(yRotation(0))).toBeCloseTo(0, 5);
  });

  test('recovers the rotation it was built from', () => {
    for (const angle of [-150, -80, -35, -10, 15, 35, 80, 150]) {
      expect(yawFromMatrix(yRotation(angle))).toBeCloseTo(angle, 4);
    }
  });

  test('positive yaw means the client is showing their RIGHT side', () => {
    // Turning to their own left swings the nose toward the image's right, which
    // presents the right side of the head — the convention convex/lib/chair.ts
    // documents and ANGLE_SPECS depends on.
    const forwardX = (m: ReturnType<typeof yRotation>) => m.data[8];
    expect(forwardX(yRotation(80))).toBeGreaterThan(0);
    expect(yawFromMatrix(yRotation(80))).toBeGreaterThan(0);
    expect(yawFromMatrix(yRotation(-80))).toBeLessThan(0);
  });

  test('reads column-major, not row-major', () => {
    // At 90° the two layouts disagree in sign, so this pins the layout itself.
    expect(yawFromMatrix(yRotation(90))).toBeCloseTo(90, 4);
  });
});

/** An ImageData-shaped stub — jsdom has no canvas. */
function image(width: number, height: number, greenAt: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[(y * width + x) * 4 + 1] = greenAt(x, y);
    }
  }
  return { data, width, height } as ImageData;
}

describe('laplacianVariance', () => {
  test('a flat image has no detail at all', () => {
    expect(laplacianVariance(image(16, 16, () => 128))).toBeCloseTo(0, 6);
  });

  test('a sharp checkerboard scores far above a soft gradient', () => {
    const sharp = laplacianVariance(image(16, 16, (x, y) => ((x + y) % 2 ? 255 : 0)));
    const soft = laplacianVariance(image(16, 16, (x) => x * 8));
    expect(sharp).toBeGreaterThan(soft * 10);
  });

  test('blurring the same content lowers the score — the property picks use', () => {
    const crisp = laplacianVariance(image(32, 32, (x) => (x < 16 ? 0 : 255)));
    const blurred = laplacianVariance(
      image(32, 32, (x) => Math.min(255, Math.max(0, (x - 8) * 16))),
    );
    expect(crisp).toBeGreaterThan(blurred);
  });

  test('images too small to convolve return zero rather than throwing', () => {
    expect(laplacianVariance(image(2, 2, () => 100))).toBe(0);
    expect(laplacianVariance(image(1, 1, () => 100))).toBe(0);
  });
});
