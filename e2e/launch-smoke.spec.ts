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

test('the front door opens onto the chair, with the studio kept one door back', async ({ page }) => {
  await page.goto('/');
  // / forwards to the chair. Signed out, that's the chair-styled sign-in gate
  // (which keeps a quiet link to the card builder); signed in, it's Lucy's
  // name + phone screen. The barber pitch lives at /for-barbers now.
  await page.waitForURL('**/chair');
  await expect(page.locator('a[href="/barber/card"]').first()).toBeVisible();

  // The barber pitch and the consumer landing still exist one door back.
  await page.goto('/for-barbers');
  await expect(page.locator('a[href="/try"]').first()).toBeVisible();
  await page.goto('/try');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
});
