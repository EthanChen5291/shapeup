import { expect, test } from '@playwright/test';

// Between the mobile breakpoint and full desktop (e.g. a laptop zoomed to
// 125–150%) the hero's fixed-width blob used to squeeze the headline column
// until "test-drive" broke across lines one word at a time.
for (const width of [800, 900, 1000, 1100, 1280]) {
  test(`hero headline stays readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

    const firstLine = page.getByText('test-drive', { exact: true }).first();
    await expect(firstLine).toBeVisible();

    const { lineHeight, height } = await firstLine.evaluate((el) => ({
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      height: el.getBoundingClientRect().height,
    }));
    // One line, not "test-" / "drive".
    expect(height).toBeLessThan(lineHeight * 1.5);

    const secondLine = page.getByText(/^your next cut\.$/).first();
    const second = await secondLine.evaluate((el) => ({
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      height: el.getBoundingClientRect().height,
    }));
    expect(second.height).toBeLessThan(second.lineHeight * 1.5);

    // No horizontal page scroll from the blob column.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

// The hero's picture is a looping render of a head trying on hairstyles: the women's catalog
// first, the men's behind the two arrows at its sides. It replaced clips the visitor swiped
// through with the wheel, so the wheel over the head scrolls the page again.
for (const width of [390, 1280]) {
  test(`hero turntable plays on its own and its arrows switch renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

    const women = page.locator('[data-clip="women"]');
    const men = page.locator('[data-clip="men"]');
    const video = women.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', '/landing_turntable/turntable.mp4');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBe(true);

    // A square inside the blob, not stretched.
    const box = await video.boundingBox();
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);

    // The old sprite arrows are gone; the new ones are real buttons big enough to tap.
    await expect(page.locator('img[src*="/arrows/"]')).toHaveCount(0);
    const next = page.getByRole('button', { name: 'Next model' });
    const prev = page.getByRole('button', { name: 'Previous model' });
    // (Polled: the hero scales in on load, and a box measured mid-entrance is a hair small.)
    for (const arrow of [prev, next]) {
      await expect.poll(async () => Math.min(...Object.values(await arrow.evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))))).toBeGreaterThanOrEqual(44);
    }

    await next.click();
    await expect(men).toHaveAttribute('data-shown', 'true');
    await expect(men.locator('video')).toHaveAttribute('src', '/landing_turntable/turntable_men.mp4');
    // It settles: normal speed, playing, and the women's loop stopped behind it.
    await expect.poll(() => men.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.playbackRate === 1)).toBe(true);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

    await prev.click();
    await expect(women).toHaveAttribute('data-shown', 'true');

    // The wheel over the head scrolls the page instead of switching clips.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop)).toBeGreaterThan(0);
  });
}
