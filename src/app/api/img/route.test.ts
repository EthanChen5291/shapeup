import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// /api/img: auth → prefix allowlist → (ownership ∥ signing) → stream from S3.

const query = vi.fn();
const getToken = vi.fn();
const sign = vi.fn();

beforeEach(() => {
  vi.resetModules();
  query.mockReset(); getToken.mockReset(); sign.mockReset();
  vi.doMock('@/lib/serverAuth', () => ({
    requireSignedIn: vi.fn().mockResolvedValue({ session: { getToken } }),
    // Mirrors serverAuth.getConvexToken: mint from the fake session.
    getConvexToken: async (session: { getToken: (o: { template: string }) => Promise<string | null> }) => {
      const token = await session.getToken({ template: 'convex' });
      return token ? { token, response: null } : { token: null, response: new Response('Unauthorized', { status: 401 }) };
    },
  }));
  vi.doMock('@/lib/s3', () => ({ getSignedDownloadUrl: sign }));
  vi.doMock('convex/browser', () => ({
    ConvexHttpClient: class { setAuth() {} query = query; },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@/lib/serverAuth'); vi.doUnmock('@/lib/s3'); vi.doUnmock('convex/browser'); });

async function get(key: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`https://shapeup.test/api/img?key=${encodeURIComponent(key)}`));
}

function s3Returns(bytes: Uint8Array, type = 'image/webp') {
  const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': type, 'content-length': String(bytes.length) } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('/api/img', () => {
  it('streams a thumbnail through with S3’s type and length, cached privately', async () => {
    sign.mockResolvedValue('https://s3.test/signed');
    const fetchMock = s3Returns(new Uint8Array([1, 2, 3, 4]));
    const res = await get('thumbnails/abc.webp');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://s3.test/signed');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-length')).toBe('4');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(query).not.toHaveBeenCalled(); // thumbnails skip the ownership round-trip
  });

  it('signs while the ownership check runs, and refuses a key the caller does not own', async () => {
    let releaseOwnership: (v: boolean) => void = () => {};
    getToken.mockResolvedValue('jwt');
    query.mockReturnValue(new Promise<boolean>(r => { releaseOwnership = r; }));
    sign.mockResolvedValue('https://s3.test/signed');
    const fetchMock = s3Returns(new Uint8Array([9]));
    const pending = get('pictures/someone-else.png');
    await vi.waitFor(() => expect(sign).toHaveBeenCalled()); // signing did not wait for ownership
    releaseOwnership(false);
    const res = await pending;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled(); // bytes never fetched for a denied key
  });

  it('rejects keys outside the allowed prefixes, and 404s when S3 has nothing', async () => {
    expect((await get('facelifts/x/output.splat')).status).toBe(403);
    sign.mockRejectedValue(new Error('nope'));
    expect((await get('thumbnails/missing.webp')).status).toBe(404);
  });
});
