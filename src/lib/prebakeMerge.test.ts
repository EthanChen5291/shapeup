import { describe, expect, test, vi } from 'vitest';
import { createMergeCore, createPrebakeMerger, type MergeWorkerResponse } from './prebakeMerge';
import { SPLAT_ROW } from './splatMerge';

const rows = (n: number, z = 0) => {
  const buf = new ArrayBuffer(n * SPLAT_ROW);
  for (let i = 0; i < n; i++) new Float32Array(buf, i * SPLAT_ROW, 6).set([0, 0, z, 1, 1, 1]);
  return buf;
};
const fetchSplat = (bytes: ArrayBuffer) => vi.fn(async (input: RequestInfo | URL) => (
  String(input).endsWith('.spz')
    ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    : { ok: true, status: 200, arrayBuffer: async () => bytes }
)) as unknown as typeof fetch;

describe('createMergeCore', () => {
  test('merges fetched hair into the base and caches the hair by variant', async () => {
    const f = fetchSplat(rows(2, 0.5));
    const core = createMergeCore(f);
    core.setBase(rows(3));
    const req = { type: 'merge' as const, id: 1, variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true, opts: { k: 1, dz: -0.1 } };
    const a = await core.merge(req);
    const b = await core.merge({ ...req, id: 2 });
    expect(a.type).toBe('merged');
    if (a.type !== 'merged' || b.type !== 'merged') throw new Error('expected merged');
    expect(a.bytes.byteLength).toBe(5 * SPLAT_ROW);
    expect(new Float32Array(a.bytes, 3 * SPLAT_ROW, 3)[2]).toBeCloseTo(0.4, 6); // hair z + dz
    // .spz tried then .splat, once: the second merge came from the cache.
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  test('forwards download progress with the request id, and not for a cached hair', async () => {
    const chunk = new Uint8Array(rows(2, 0.5));
    const f = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('.spz')
      ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, headers: { get: () => String(chunk.byteLength) },
          body: { getReader: () => { let done = false; return { read: async () => (done ? { value: undefined, done: true } : (done = true, { value: chunk, done: false })) }; } } })) as unknown as typeof fetch;
    const core = createMergeCore(f); core.setBase(rows(1));
    const seen: unknown[] = [];
    const req = { type: 'merge' as const, id: 7, variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true, opts: { k: 1 } };
    await core.merge(req, (p) => seen.push(p));
    expect(seen).toEqual([{ type: 'progress', id: 7, loaded: chunk.byteLength, total: chunk.byteLength }]);
    await core.merge({ ...req, id: 8 }, (p) => seen.push(p));
    expect(seen).toHaveLength(1); // second merge served from the hair cache
  });

  test('warm fills the hair cache so the merge that follows does not fetch', async () => {
    const f = fetchSplat(rows(2, 0.25));
    const core = createMergeCore(f); core.setBase(rows(1));
    expect(core.has('v')).toBe(false);
    await core.handle({ type: 'warm', variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true });
    expect(core.has('v')).toBe(true);
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const res = await core.merge({ type: 'merge', id: 1, variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true, opts: { k: 1 } });
    expect(res.type).toBe('merged');
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  test('reports an error instead of throwing when there is no base or the fetch fails', async () => {
    const core = createMergeCore(fetchSplat(rows(1)));
    const r1 = await core.merge({ type: 'merge', id: 1, variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: false, opts: { k: 1 } });
    expect(r1).toEqual({ type: 'error', id: 1, message: 'no base head loaded' });
    core.setBase(rows(1));
    const failing = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const r2 = await createMergeCore(failing).handle({ type: 'base', bytes: rows(1) });
    expect(r2).toBeNull();
  });
});

describe('in-flight warms', () => {
  test('a merge requested while its warm is still downloading joins that download', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const bytes = rows(2, 0.5);
    const f = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('.spz')) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      await gate;
      return { ok: true, status: 200, arrayBuffer: async () => bytes };
    }) as unknown as typeof fetch;
    const core = createMergeCore(f); core.setBase(rows(1));
    const warm = core.warm({ type: 'warm', variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true });
    const merge = core.merge({ type: 'merge', id: 1, variantId: 'v', splatUrl: '/prebake/men/a-x.splat', preferSpz: true, opts: { k: 1 } });
    release();
    const [, res] = await Promise.all([warm, merge]);
    expect(res.type).toBe('merged');
    // .spz (404) then .splat, once: the merge did not start its own download.
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

describe('centerShift', () => {
  test('moves the hair so its temple-band extent is centred on the wearer, scaled by k·kx; 0 when unmeasurable', async () => {
    const { centerShift } = await import('./prebakeMergeCore');
    // 200 rows across x 0.1…0.5 at the temple band (z 0.25, front), i.e. centred on 0.3.
    const buf = new ArrayBuffer(200 * SPLAT_ROW);
    for (let i = 0; i < 200; i++) {
      new Float32Array(buf, i * SPLAT_ROW, 6).set([0.1 + (0.4 * i) / 199, -0.2, 0.25, 0.01, 0.01, 0.01]);
      new Uint8Array(buf, i * SPLAT_ROW + 24, 4).set([0, 0, 0, 255]);
    }
    expect(centerShift(buf, 0, 1, 1)).toBeCloseTo(-0.3, 2);
    expect(centerShift(buf, -0.01, 2, 1.1)).toBeCloseTo(-0.01 - 0.3 * 2.2, 2);
    expect(centerShift(buf, undefined, 1, 1)).toBe(0);
    expect(centerShift(rows(3), 0, 1, 1)).toBe(0); // too few rows in the band
  });
});

describe('createPrebakeMerger', () => {
  test('without a Worker it merges on the calling thread', async () => {
    const m = createPrebakeMerger(null, fetchSplat(rows(1, 1)));
    m.setBase(rows(2));
    const out = await m.merge('v', '/prebake/women/b-y.splat', { k: 2 }, false);
    expect(out.byteLength).toBe(3 * SPLAT_ROW);
    expect(new Float32Array(out, 2 * SPLAT_ROW, 3)[2]).toBe(2); // z × k
    m.dispose();
  });

  test('with a Worker it posts requests and resolves on the matching reply, transferring nothing it still needs', async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const posted: unknown[] = [];
    const worker = {
      postMessage: (msg: unknown) => { posted.push(msg); },
      terminate: vi.fn(),
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    };
    const m = createPrebakeMerger(worker as never);
    const base = rows(1);
    m.setBase(base);
    expect((posted[0] as { bytes: ArrayBuffer }).bytes).not.toBe(base); // a copy, the caller keeps its own
    const progress: Array<[number, number]> = [];
    const p = m.merge('v', '/prebake/men/a-x.splat', { k: 1 }, true, (l, t) => progress.push([l, t]));
    const req = posted[1] as { type: string; id: number; variantId: string };
    expect(req).toMatchObject({ type: 'merge', variantId: 'v' });
    listeners.message({ data: { type: 'progress', id: req.id, loaded: 10, total: 40 } });
    expect(progress).toEqual([[10, 40]]);
    listeners.message({ data: { type: 'merged', id: req.id, bytes: rows(4) } satisfies MergeWorkerResponse });
    expect((await p).byteLength).toBe(4 * SPLAT_ROW);
    const q = m.merge('w', '/prebake/men/a-y.splat', { k: 1 }, true);
    listeners.message({ data: { type: 'error', id: (posted[2] as { id: number }).id, message: 'prebake 404' } });
    await expect(q).rejects.toThrow('prebake 404');
    m.warm('w2', '/prebake/men/a-z.splat', true);
    expect(posted[posted.length - 1]).toEqual({ type: 'warm', variantId: 'w2', splatUrl: '/prebake/men/a-z.splat', preferSpz: true });
    m.dispose();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
