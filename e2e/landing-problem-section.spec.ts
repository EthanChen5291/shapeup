import { expect, test, type Locator } from '@playwright/test';

const look = (el: Locator) => el.evaluate((node) => {
  const s = getComputedStyle(node);
  const after = getComputedStyle(node, '::after');
  return { transform: s.transform, borderColor: s.borderColor, boxShadow: s.boxShadow, glow: after.boxShadow };
});

test.describe('landing: problem section and how-it-works heading', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
  });

  test('the headline is lowercase, and its punchline is the barber in Comic Sans on a crumpled receipt', async ({ page }) => {
    const note = page.locator('.crumpled-note');
    await expect(note).toBeVisible();
    await expect(note.locator('.sr-only')).toHaveText('your barber hears something different...');
    const headline = note.locator('xpath=ancestor::h2');
    await expect(headline).toContainText('you describe it.');
    await expect(headline).not.toContainText('You describe it.');

    const look = await note.evaluate((el) => {
      const s = getComputedStyle(el);
      const paper = getComputedStyle(el, '::before');
      const letter = getComputedStyle(el.querySelector('.crumpled-note__letter')!);
      return {
        family: s.fontFamily, style: s.fontStyle,
        size: parseFloat(s.fontSize), headline: parseFloat(getComputedStyle(el.closest('h2')!).fontSize),
        paper: paper.backgroundImage,
        ink: letter.backgroundImage, clip: letter.backgroundClip || letter.getPropertyValue('-webkit-background-clip'),
        tilts: new Set([...el.querySelectorAll<HTMLElement>('.crumpled-note__letter')].map((l) => l.style.transform)).size,
      };
    });
    expect(look.family).toMatch(/^"?Comic Sans MS/);
    expect(look.style).toBe('normal');
    // 20% smaller than the line above it.
    expect(look.size / look.headline).toBeCloseTo(0.8, 2);
    // On the receipt, in airbrushed ink, each letter nudged its own way.
    expect(look.paper).toContain('/landing_paper/receipt_wide.webp');
    expect(look.ink).toContain('linear-gradient');
    expect(look.clip).toBe('text');
    expect(look.tilts).toBeGreaterThan(15);
  });

  test('the receipt has room above it and stays inside a phone screen', async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const note = page.locator('.crumpled-note');
      await note.scrollIntoViewIfNeeded();
      const m = await note.evaluate((el) => {
        const paper = getComputedStyle(el, '::before');
        const box = el.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(el).fontSize);
        // The paper overhangs the text box by its (negative) insets.
        const left = box.left + parseFloat(paper.left), right = box.right - parseFloat(paper.right), top = box.top + parseFloat(paper.top);
        const line = document.createRange();
        line.selectNodeContents(el.closest('h2')!.firstChild!); // "you describe it."
        return { left, right, gapAbove: top - line.getBoundingClientRect().bottom, em, viewport: window.innerWidth, paper: paper.backgroundImage };
      });
      expect(m.left, `left edge at ${width}`).toBeGreaterThanOrEqual(0);
      expect(m.right, `right edge at ${width}`).toBeLessThanOrEqual(m.viewport);
      expect(m.gapAbove, `gap above at ${width}`).toBeGreaterThan(m.em * 0.3);
      expect(m.paper).toContain(width < 769 ? 'receipt_tall' : 'receipt_wide');
    }
  });

  test('"how it works:" is one plain phrase: one colour, upright, ending in a colon', async ({ page }) => {
    const heading = page.locator('#how-it-works h2');
    await expect(heading).toHaveText('how it works:');
    await expect(heading.locator('em')).toHaveCount(0);
    expect(await heading.evaluate((el) => getComputedStyle(el).fontStyle)).toBe('normal');
  });

  test('the comparison cards do not react to the pointer', async ({ page }) => {
    for (const name of ['6 week recovery', '60-sec edit']) {
      const card = page.getByText(name, { exact: true }).locator('xpath=ancestor::div[contains(@class,"compare-card")]');
      await card.scrollIntoViewIfNeeded();
      // Let the scroll-in reveal finish before taking the resting look.
      await expect.poll(() => card.evaluate((el) => getComputedStyle(el.closest('.reveal') ?? el).opacity)).toBe('1');
      await page.waitForTimeout(900);
      const resting = await look(card);
      await card.hover();
      await page.waitForTimeout(450); // longer than the old 280 ms hover transition
      expect(await look(card), name).toEqual(resting);
    }
  });
});
