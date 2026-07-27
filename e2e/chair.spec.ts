import { expect, test } from '@playwright/test';

// Chair mode in a real browser.
//
// Scope note: /chair is barber-only and this suite has no Clerk session, so
// these tests cover the auth gate, the route's health, and the self-hosted
// assets the reference sheet depends on. The signed-in walk (roster → consent →
// live → review → saved) is covered as a component test instead, in
// src/components/chair/ChairStation.test.tsx — same convention the builder
// follows in barber-page.spec.ts.

test('the chair is reachable and gates the station behind a barber sign-in', async ({ page }) => {
  await page.goto('/chair');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('body')).toContainText(/chair mode/i);
  await expect(page.locator('body')).toContainText(/sign in with your barber account/i);
  // The station itself must not render for a signed-out visitor.
  await expect(page.locator('.chair-roster')).toHaveCount(0);
  await expect(page.locator('.chair-live')).toHaveCount(0);
});

test('a signed-out visitor is pointed at the card setup they actually need first', async ({ page }) => {
  await page.goto('/chair');
  await expect(page.locator('a[href="/barber/card"]')).toBeVisible();
});

test('the chair renders dark, so it does not glare into the mirror', async ({ page }) => {
  await page.goto('/chair');
  const background = await page
    .locator('main.chair')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // --void, #0F0F10
  expect(background).toBe('rgb(15, 15, 16)');
});

test('the face-landmarker assets are self-hosted, so shop wifi cannot break the sheet', async ({
  request,
}) => {
  const model = await request.get('/mediapipe/face_landmarker.task');
  expect(model.status()).toBe(200);
  expect(Number(model.headers()['content-length'])).toBeGreaterThan(1_000_000);

  const wasm = await request.get('/mediapipe/wasm/vision_wasm_internal.js');
  expect(wasm.status()).toBe(200);
});

test('the token route refuses an unauthenticated caller', async ({ request }) => {
  const res = await request.post('/api/fal/realtime-token', {
    data: { clientId: 'c1', prompt: 'give this person a low taper' },
    failOnStatusCode: false,
  });
  // 401 when Clerk is configured, 503 when the deployment has no FAL_KEY —
  // either way, no token comes back.
  expect([401, 503]).toContain(res.status());
  expect(await res.text()).not.toContain('token');
});

test('the chair works at the sizes a shop tablet actually uses', async ({ page }) => {
  for (const size of [
    { width: 768, height: 1024 }, // iPad portrait
    { width: 1024, height: 768 }, // iPad landscape, on a stand
    { width: 390, height: 844 }, // a phone in a pinch
  ]) {
    await page.setViewportSize(size);
    await page.goto('/chair');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, `horizontal scroll at ${size.width}×${size.height}`).toBe(false);
  }
});
