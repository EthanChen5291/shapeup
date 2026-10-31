import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWarmedSplats, splatUrl, warmSplat } from './warmSplat';

afterEach(() => { resetWarmedSplats(); vi.unstubAllGlobals(); });

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });

describe('warmSplat', () => {
  it('fetches the same URL the studio loads, once per key', () => {
    const f = okFetch();
    expect(warmSplat('facelifts/job/output.splat', f as unknown as typeof fetch)).toBe(true);
    expect(warmSplat('facelifts/job/output.splat', f as unknown as typeof fetch)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(splatUrl('facelifts/job/output.splat'));
    expect(splatUrl('a b')).toBe('/api/proxy-ply?key=a%20b');
  });

  it('does nothing without a key or when the visitor saves data', () => {
    const f = okFetch();
    expect(warmSplat(undefined, f as unknown as typeof fetch)).toBe(false);
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    expect(warmSplat('k', f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('allows a retry after a failed download', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    warmSplat('k', f as unknown as typeof fetch);
    await new Promise(r => setTimeout(r, 0));
    expect(warmSplat('k', f as unknown as typeof fetch)).toBe(true);
  });
});
