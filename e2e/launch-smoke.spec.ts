import { expect, test } from '@playwright/test';

test('health endpoint is available without authentication', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  await expect(await res.json()).toMatchObject({ status: 'ok' });
});

test('public app shell renders without a client-side crash', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('body')).toContainText(/shapeup|unchopped|hair/i);
});

test('the front door is barber-first, with the studio kept one door back', async ({ page }) => {
  await page.goto('/');
  // Signed out, / is the barber pitch: build-a-card CTA plus the quieter
  // door for clients (the consumer studio). The dashboard is gone — signed-in
  // barbers land on /chair.
  await expect(page.locator('a[href="/barber/card"]').first()).toBeVisible();
  await expect(page.locator('a[href="/try"]').first()).toBeVisible();

  // The consumer landing still exists at /try.
  await page.goto('/try');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
});
