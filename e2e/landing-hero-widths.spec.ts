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
