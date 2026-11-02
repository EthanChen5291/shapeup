import { describe, expect, test } from 'vitest';
import { DEFAULT_VIEWER_TRANSFORM, parseSplatMeta, splatSizeMatches, viewerTransform } from './splatMeta';

const sample = {
  schema_version: 1,
  job_id: 'job_1',
  created_at: '2026-10-30T12:00:00+00:00',
  model: { name: 'facelift', commit: 'abc1234', seed: 4, steps_2d: 50 },
  gpu: { name: 'NVIDIA L40S' },
  output: { splat_s3_key: 'facelifts/job_1/output.splat', gaussian_count: 190072 },
  viewer: { rotation_euler_xyz: [-1.5707963, 3.1415927, 3.1415927], scale: 2.772, position: [0, -0.07, 0.48] },
};

describe('parseSplatMeta', () => {
  test('parses a worker-written sidecar', () => {
    const m = parseSplatMeta(sample);
    expect(m).not.toBeNull();
    expect(m!.jobId).toBe('job_1');
    expect(m!.model.commit).toBe('abc1234');
    expect(m!.model.seed).toBe(4);
    expect(m!.gpu.name).toBe('NVIDIA L40S');
    expect(m!.output.gaussianCount).toBe(190072);
    expect(m!.viewer.scale).toBe(2.772);
    expect(m!.viewer.position).toEqual([0, -0.07, 0.48]);
  });

  test('rejects anything that is not a v1 sidecar', () => {
    expect(parseSplatMeta(null)).toBeNull();
    expect(parseSplatMeta('nope')).toBeNull();
    expect(parseSplatMeta({ schema_version: 2, job_id: 'x' })).toBeNull();
    expect(parseSplatMeta({ schema_version: 1 })).toBeNull();
  });

  test('falls back to the viewer constants for missing or malformed transform fields', () => {
    const m = parseSplatMeta({ schema_version: 1, job_id: 'j', viewer: { scale: 'big', position: [1, 2] } });
    expect(m!.viewer).toEqual(DEFAULT_VIEWER_TRANSFORM);
  });
});

describe('viewerTransform', () => {
  test('uses the sidecar when present and the constants otherwise', () => {
    expect(viewerTransform(null)).toBe(DEFAULT_VIEWER_TRANSFORM);
    const m = parseSplatMeta({ ...sample, viewer: { ...sample.viewer, scale: 3 } });
    expect(viewerTransform(m).scale).toBe(3);
  });
});

describe('splat integrity fields', () => {
  const sha = 'a'.repeat(64);
  test('parses the exact size and sha256 the worker recorded', () => {
    const m = parseSplatMeta({ ...sample, output: { ...sample.output, splat_bytes: 6082304, sha256: sha } });
    expect(m!.output.splatBytes).toBe(6082304);
    expect(m!.output.sha256).toBe(sha);
  });

  test('drops a malformed hash', () => {
    const m = parseSplatMeta({ ...sample, output: { ...sample.output, sha256: 'not-a-hash' } });
    expect(m!.output.sha256).toBeNull();
  });

  test('splatSizeMatches compares against splat_bytes, and passes heads that predate it', () => {
    const m = parseSplatMeta({ ...sample, output: { ...sample.output, splat_bytes: 320 } });
    expect(splatSizeMatches(m, 320)).toBe(true);
    expect(splatSizeMatches(m, 288)).toBe(false);
    expect(splatSizeMatches(parseSplatMeta(sample), 288)).toBe(true);
    expect(splatSizeMatches(null, 288)).toBe(true);
  });
});
