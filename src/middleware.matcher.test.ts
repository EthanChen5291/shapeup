import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: (fn: unknown) => fn, createRouteMatcher: () => () => false }));

// The first matcher entry is a plain regex over the path (Next wraps it in ^…$).
async function pageMatcher() {
  const { config } = await import('./middleware');
  return new RegExp(`^${config.matcher[0]}$`);
}

describe('middleware matcher', () => {
  it('skips Clerk for static media: landing videos, fonts, splats', async () => {
    const m = await pageMatcher();
    for (const p of ['/landing_face1/face1a.mp4', '/fonts/x.otf', '/subtraction-bald.splat', '/models/head.glb', '/icon.png', '/a.webp']) {
      expect(m.test(p), p).toBe(false);
    }
  });
  it('still runs on pages', async () => {
    const m = await pageMatcher();
    for (const p of ['/', '/dashboard', '/studio/abc', '/admin']) expect(m.test(p), p).toBe(true);
  });
});

describe('landing redirect', () => {
  const run = async (path: string, userId: string | null) => {
    const { NextRequest } = await import('next/server');
    const mw = (await import('./middleware')).default as unknown as (auth: () => Promise<{ userId: string | null }>, req: InstanceType<typeof NextRequest>) => Promise<Response | undefined>;
    return mw(async () => ({ userId }), new NextRequest(`https://shapeup.test${path}`));
  };

  it('sends a signed-in visitor from / straight to /dashboard, keeping the query', async () => {
    const res = await run('/?ref=abc', 'user_1');
    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toBe('https://shapeup.test/dashboard?ref=abc');
  });

  it('lets signed-out visitors (and every other page) through', async () => {
    expect(await run('/', null)).toBeUndefined();
    expect(await run('/pricing', 'user_1')).toBeUndefined();
  });
});
