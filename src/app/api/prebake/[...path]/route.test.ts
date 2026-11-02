import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PREBAKE_CACHE_MAX_AGE_S, prebakeKeyFromSegments } from '@/lib/prebakeKeys';

const getSignedDownloadUrl = vi.fn(async (key: string) => `https://bucket.s3.example/${key}?sig=1`);

beforeEach(() => {
  vi.resetModules();
  getSignedDownloadUrl.mockClear();
  vi.doMock('@/lib/s3', () => ({ getSignedDownloadUrl }));
});

const call = async (path: string[]) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`https://shapeup.test/api/prebake/${path.join('/')}`), { params: Promise.resolve({ path }) });
};

describe('prebakeKeyFromSegments', () => {
  test('maps a gender dir + .splat file to the S3 key', () => {
    expect(prebakeKeyFromSegments(['men', 'middlepart_black.splat'])).toBe('prebake/men/middlepart_black.splat');
    expect(prebakeKeyFromSegments(['men', 'middlepart_black.spz'])).toBe('prebake/men/middlepart_black.spz');
    expect(prebakeKeyFromSegments(['women', 'mediumcurtains_brown-blondestreaks.splat'])).toBe('prebake/women/mediumcurtains_brown-blondestreaks.splat');
  });
  test('rejects anything else', () => {
    for (const bad of [[], ['men'], ['kids', 'a.splat'], ['men', '../x.splat'], ['men', 'a.ply'], ['men', '.hidden.splat'], ['men', 'a', 'b.splat'], ['men', 'a b.splat']]) {
      expect(prebakeKeyFromSegments(bad)).toBeNull();
    }
  });
});

describe('/api/prebake/[...path]', () => {
  test('redirects to a signed URL for the prebake key and lets the browser cache it for a day', async () => {
    const res = await call(['men', 'topshort_black.splat']);
    expect(res.status).toBe(307);
    expect(getSignedDownloadUrl).toHaveBeenCalledWith('prebake/men/topshort_black.splat');
    expect(res.headers.get('location')).toBe('https://bucket.s3.example/prebake/men/topshort_black.splat?sig=1');
    expect(res.headers.get('cache-control')).toBe(`private, max-age=${PREBAKE_CACHE_MAX_AGE_S}`);
  });

  test('never signs a key outside prebake/', async () => {
    const res = await call(['..', 'facelifts', 'job.splat']);
    expect(res.status).toBe(400);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
