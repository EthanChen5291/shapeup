import { expect, test } from '@playwright/test';

// The take debug area in a real browser.
//
// Scope note: same convention as chair.spec.ts — this suite has no Clerk
// session, so it proves the gates hold for outsiders: the middleware bounces
// page visitors home and hands API callers a clean 403. The admin-eye view of
// the feed (prompt next to snapshots next to footage) is covered as a
// component test in src/app/admin/takes/page.test.tsx, and the feed's own
// authorization in convex/chair.test.ts.

test('a signed-out visitor never sees the takes debug shell', async ({ page }) => {
  await page.goto('/admin/takes');
  // The middleware redirect lands home before the admin shell can render.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('body')).not.toContainText(/what Lucy was told/i);
});

test('the takes feed API refuses an unauthenticated caller', async ({ request }) => {
  const res = await request.get('/api/admin-takes', { failOnStatusCode: false });
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain('prompt');
});
