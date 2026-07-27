import { expect, test } from '@playwright/test';

test('the public barber ticket preserves the barber/ShapeUp split and leads with the live mirror', async ({ page }) => {
  await page.goto('/b/playwright-preview');

  const barber = page.locator('.bc-side');
  const experience = page.locator('.bc-exp');
  await expect(barber.getByRole('heading', { level: 1, name: 'Marcus Rivera' })).toBeVisible();
  await expect(barber).toContainText('Fade Theory');
  await expect(barber).toContainText('Oakland, CA');
  await expect(barber).toContainText('Signature cut');
  await expect(barber.getByRole('link', { name: /Book with Marcus/ })).toBeVisible();

  // The live mirror IS the experience — no choice screen or lookbook detour
  // stands in front of it. Signed out, its first ask is the sign-in.
  await expect(experience.locator('.bt-panel')).toBeVisible();
  await expect(experience).not.toContainText('What are we doing today?');
  await expect(experience.getByRole('button', { name: 'Just doing a trim.' })).toHaveCount(0);
  await expect(experience.getByRole('button', { name: 'Show me my best hairstyles' })).toHaveCount(0);
  await expect(experience).not.toContainText('Marcus Rivera');
  await expect(experience).toContainText(/sign|account|continue/i, { timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText('FREE — NO APP');
  await expect(page.locator('body')).not.toContainText('Shop your next cut on your own head.');
  expect(await page.content()).not.toContain('landing_face2');

  // The flow behind the sign-in is a live take, not a photo. Nothing in the
  // panel may offer a selfie, a shutter, or a file picker — that flow is gone.
  await expect(experience).not.toContainText(/selfie/i);
  await expect(experience.locator('input[type="file"]')).toHaveCount(0);
});

test('the public ticket uses the required vertical order on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/b/playwright-preview');

  const positions = await page.evaluate(() => {
    const who = document.querySelector('.bc-who')?.getBoundingClientRect();
    const experience = document.querySelector('.bc-exp')?.getBoundingClientRect();
    const details = document.querySelector('.bc-details')?.getBoundingClientRect();
    return {
      whoTop: who?.top ?? -1,
      experienceTop: experience?.top ?? -1,
      detailsTop: details?.top ?? -1,
      layoutDirection: getComputedStyle(document.querySelector('.bc-layout')!).flexDirection,
    };
  });

  expect(positions.layoutDirection).toBe('column');
  expect(positions.whoTop).toBeGreaterThanOrEqual(0);
  expect(positions.experienceTop).toBeGreaterThan(positions.whoTop);
  expect(positions.detailsTop).toBeGreaterThan(positions.experienceTop);
  await expect(page.locator('body')).toHaveCSS('overflow-x', 'hidden');
});

test('the desktop ticket renders the diagonal split', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/b/playwright-preview');
  await expect(page.locator('.bc-seam')).toHaveCSS('display', 'block');
  await expect(page.locator('.bc-layout')).toHaveCSS('grid-template-columns', /.+ .+/);
});

// The card's dim/faint tokens are literal ink alphas over a light surface. On
// a dark surface (an OS-dark visitor, or the builder's preview — /barber/card
// is an always-dark route) they used to land dark-on-dark and the section
// labels, bio and hours vanished into the background.
test('the card keeps its quiet text legible on both surfaces', async ({ page }) => {
  await page.goto('/b/playwright-preview');

  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);

    const ratios = await page.evaluate(() => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const parse = (v: string) => (v.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = ([r, g, b]: number[]) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

      const surface = parse(getComputedStyle(document.querySelector('.bc-root')!).backgroundColor);
      return ['.bc-side-heading', '.bc-bio', '.bc-hours', '.bc-foot-link'].map((selector) => {
        const [r, g, b, a = 1] = parse(getComputedStyle(document.querySelector(selector)!).color);
        // Flatten the text's alpha onto the surface it actually sits on.
        const blended = [r, g, b].map((c, i) => c * a + surface[i] * (1 - a));
        const [lo, hi] = [luminance(blended), luminance(surface)].sort((x, y) => x - y);
        return { selector, ratio: (hi + 0.05) / (lo + 0.05) };
      });
    });

    for (const { selector, ratio } of ratios) {
      expect(ratio, `${selector} on ${dark ? 'dark' : 'light'}`).toBeGreaterThan(4.5);
    }
  }
});

test('the for-barbers pitch page routes into the builder without crashing', async ({ page }) => {
  await page.goto('/for-barbers');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('a[href="/barber/card"]').first()).toBeVisible();
});

test('an unknown barber ticket 404s cleanly', async ({ page }) => {
  const response = await page.goto('/b/definitely-not-a-real-barber-slug');
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
});

test('the builder is reachable and gates editing behind sign-in', async ({ page }) => {
  await page.goto('/barber/card');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('body')).toContainText(/sign in|build your barber card/i);
  await expect(page.locator('.barber-builder-form')).toHaveCount(0);
});

test('the dashboard is gone — /barber lands on the chair', async ({ page }) => {
  // The chair IS the barber app now. Old dashboard links and muscle memory
  // still point at /barber, so it must land on /chair rather than 404.
  await page.goto('/barber');
  await page.waitForURL('**/chair');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  // And the old tab routes really are gone, not quietly rendering a shell.
  for (const path of ['/barber/calendar', '/barber/clients', '/barber/insights']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
