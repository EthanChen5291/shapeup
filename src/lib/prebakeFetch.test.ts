import { describe, expect, test, vi } from 'vitest';
import { encodeSpz } from './spz';
import { fetchPrebake, prebakeSpzDisabled, prefetchPrebakes, readWithProgress, spzUrlFor } from './prebakeFetch';

const rows = (n: number) => { const b = new Uint8Array(n * 32); for (let i = 0; i < n; i++) { b[i * 32 + 27] = 200; b[i * 32 + 28] = 255; } return b; };
const reply = (status: number, body: ArrayBuffer | Uint8Array = new ArrayBuffer(0)) =>
  ({ ok: status < 400, status, arrayBuffer: async () => (body instanceof Uint8Array ? body.slice().buffer : body) }) as Response;
const URL_ = '/prebake/men/buzz_black.splat';

/** A Response whose body streams `chunks`, advertising `total` bytes (or no length). */
const streaming = (chunks: Uint8Array[], total?: number) => ({
  ok: true, status: 200,
  headers: { get: (k: string) => (k === 'Content-Length' && total !== undefined ? String(total) : null) },
  body: { getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) }; } },
  arrayBuffer: async () => { throw new Error('should stream'); },
}) as unknown as Response;

describe('readWithProgress', () => {
  test('reports bytes as they arrive against the advertised total, and returns the whole body', async () => {
    const seen: Array<[number, number]> = [];
    const buf = await readWithProgress(streaming([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], 5), (l, t) => seen.push([l, t]));
    expect(seen).toEqual([[2, 5], [5, 5]]);
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4, 5]);
  });

  test('reports total 0 when the server sent no Content-Length; without a callback it just reads the body', async () => {
    const seen: number[] = [];
    await readWithProgress(streaming([new Uint8Array([9])]), (_l, t) => seen.push(t));
    expect(seen).toEqual([0]);
    await expect(readWithProgress(streaming([new Uint8Array([9])]))).rejects.toThrow('should stream');
  });
});

describe('fetchPrebake', () => {
  test('loads the .spz and decodes it to .splat rows', async () => {
    const spz = await encodeSpz(rows(5));
    const f = vi.fn(async (u: string) => (u === spzUrlFor(URL_) ? reply(200, spz) : reply(500)));
    const bytes = await fetchPrebake(URL_, f as unknown as typeof fetch, { preferSpz: true });
    expect(bytes.byteLength).toBe(5 * 32);
    expect(new Uint8Array(bytes)[27]).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/prebake/men/buzz_black.spz');
  });

  test('falls back to the .splat when the .spz is missing or corrupt', async () => {
    const splat = rows(3);
    for (const spzReply of [reply(404), reply(200, new Uint8Array([9, 9, 9]))]) {
      const f = vi.fn(async (u: string) => (u.endsWith('.spz') ? spzReply : reply(200, splat)));
      const bytes = await fetchPrebake(URL_, f as unknown as typeof fetch, { preferSpz: true });
      expect(bytes.byteLength).toBe(3 * 32);
      expect(f).toHaveBeenLastCalledWith(URL_);
    }
  });

  test('?splat skips the .spz entirely', async () => {
    expect(prebakeSpzDisabled('?splat')).toBe(true);
    expect(prebakeSpzDisabled('?project=1')).toBe(false);
    const f = vi.fn(async () => reply(200, rows(2)));
    await fetchPrebake(URL_, f as unknown as typeof fetch, { preferSpz: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(URL_);
  });

  test('throws when the .splat fails too', async () => {
    const f = vi.fn(async () => reply(404));
    await expect(fetchPrebake(URL_, f as unknown as typeof fetch, { preferSpz: true })).rejects.toThrow('prebake 404');
  });
});

describe('prefetchPrebakes', () => {
  test('warms the .spz of each url at low priority, scheduled not immediate', () => {
    const f = vi.fn(async () => reply(200));
    const queued: Array<() => void> = [];
    prefetchPrebakes(['/prebake/men/a-x.splat', '/prebake/men/a-y.splat'], f as unknown as typeof fetch,
      { preferSpz: true, schedule: (task) => queued.push(task) });
    expect(f).not.toHaveBeenCalled();
    queued.forEach((task) => task());
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/prebake/men/a-x.spz', '/prebake/men/a-y.spz']);
    expect(f.mock.calls[0][1]).toEqual({ priority: 'low' });
  });

  test('does nothing when the browser asks to save data', () => {
    const f = vi.fn(async () => reply(200));
    prefetchPrebakes(['/prebake/men/a-x.splat'], f as unknown as typeof fetch, { saveData: true, schedule: (task) => task() });
    expect(f).not.toHaveBeenCalled();
  });

  test('uses the .splat when .spz is turned off, and swallows failures', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    prefetchPrebakes(['/prebake/women/b-z.splat'], f as unknown as typeof fetch, { preferSpz: false, schedule: (task) => task() });
    expect(f).toHaveBeenCalledWith('/prebake/women/b-z.splat', { priority: 'low' });
    await Promise.resolve();
  });
});
