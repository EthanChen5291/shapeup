import { expect, test, type Page } from '@playwright/test';

// The landing's letter spill. Scrolling to the receipt (`start`) tips it and its letters roll off,
// bounce on the comparison card and leave the screen: that fall plays by itself on a clock, once,
// and is never undone. The pull then follows the scroll between `pullStart` and `pullEnd`; when it
// completes the Describe card powers on for good, and its send button gets a one-off spotlight.
// Scroll positions are computed the way the component computes them, from layout offsets (not
// bounding boxes, which the reveal animations and the tip rotation skew).
//
// The story is permanent, so every test loads the page afresh and walks it forwards only.

const SPILL = `(() => {
  const main = document.querySelector('main');
  const scroller = () => (document.body.scrollHeight > innerHeight + 1 && getComputedStyle(document.body).overflowY !== 'visible'
    ? document.body : document.scrollingElement);
  const offsetIn = (el) => { let y = 0; for (let n = el; n && n !== main; n = n.offsetParent) y += n.offsetTop; return y; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const range = () => {
    const note = document.querySelector('.crumpled-note');
    const box = document.querySelector('[data-spill-box]');
    const vh = innerHeight;
    const noteY = offsetIn(note) + note.offsetHeight / 2;
    const start = Math.max(0, noteY - 0.19 * vh);
    const pullEnd = Math.max(start + 60 + 260, offsetIn(box) - 0.76 * vh);
    const span = Math.min(clamp(0.55 * vh, 300, 560), pullEnd - start - 60);
    return { start, pullStart: pullEnd - span, pullEnd };
  };
  // The page's scroll position measured the way the component reads it.
  const where = () => -main.getBoundingClientRect().top;
  const scrollTo = (y) => { scroller().scrollTop += y - where(); };
  window.__spill = { range, scrollTo, where };
})()`;

type Range = { start: number; pullStart: number; pullEnd: number };

async function open(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.letter-spill').waitFor({ state: 'attached', timeout: 60_000 });
  await page.locator('.crumpled-note').waitFor({ state: 'attached' });
  // The server renders the layer; the border paths only exist once the page has hydrated and measured.
  await page.locator('[data-spill-border]').first().waitFor({ state: 'attached', timeout: 60_000 });
  await page.evaluate(SPILL);
}

const range = (page: Page) => page.evaluate(() => (window as any).__spill.range() as Range);
async function go(page: Page, y: number, wait = 300) {
  await page.evaluate((v) => (window as any).__spill.scrollTo(v), y);
  if (wait) await page.waitForTimeout(wait);
}

/** Walk down to just above the start, so the scroll-in reveals up there have fired but nothing has begun. */
async function warm(page: Page): Promise<Range> {
  const r = await range(page);
  for (let y = 0; y < r.start - 1; y += 250) await go(page, y, 60);
  await go(page, Math.max(0, r.start - 40), 500);
  return range(page);
}

const state = (page: Page) => page.evaluate(() => {
  const note = document.querySelector<HTMLElement>('.crumpled-note')!;
  const layer = document.querySelector<HTMLElement>('.letter-spill')!;
  const box = document.querySelector<HTMLElement>('[data-spill-box]')!;
  const heading = document.querySelector<HTMLElement>('[data-spill-text]')!;
  const paths = [...box.querySelectorAll('[data-spill-border]')];
  const copies = [...layer.children].map((c) => ({ left: c.getBoundingClientRect().left, opacity: parseFloat(getComputedStyle(c).opacity) }));
  return {
    spilled: note.hasAttribute('data-spilled'),
    active: layer.hasAttribute('data-active'),
    tip: parseFloat(note.style.getPropertyValue('--tip')) || 0,
    imprint: parseFloat(getComputedStyle(note.querySelector('[aria-hidden]')!).opacity),
    pathsHidden: paths.map((p) => getComputedStyle(p).visibility === 'hidden'),
    dashes: paths.map((p) => parseFloat(getComputedStyle(p).strokeDasharray)),
    bump: parseFloat(box.style.getPropertyValue('--spill-bump')) || 0,
    boxPowered: box.hasAttribute('data-powered'),
    textPowered: heading.hasAttribute('data-powered'),
    power: parseFloat(getComputedStyle(heading).getPropertyValue('--power')) || 0,
    copies,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  };
});

type State = Awaited<ReturnType<typeof state>>;
const parked = (s: State) => s.copies.every((c) => c.left > s.innerWidth && c.opacity === 1);
/** The border is drawn all the way round and the heading is filled. */
const lit = (s: State) => s.power === 1 && s.dashes.length > 0 && s.dashes.every((d) => d >= 0.999);
const gone = (s: State) => s.copies.every((c) => c.opacity === 0);

/** Scroll to the start and wait for the fall to finish by itself. */
async function tip(page: Page, r: Range) {
  await go(page, r.start + 2, 0);
  await expect.poll(async () => parked(await state(page)), { timeout: 15_000, intervals: [250] }).toBe(true);
}

test.describe('landing: letter spill on scroll', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 897 });
  });

  test('is quiet before the start; at the start the paper tips and the copies leave the letters', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    expect(r.pullStart).toBeGreaterThanOrEqual(r.start + 60 - 0.001);

    let s = await state(page);
    expect(s.spilled).toBe(false);
    expect(s.active).toBe(false);
    expect(s.pathsHidden.length).toBeGreaterThan(0);
    expect(s.pathsHidden.every(Boolean)).toBe(true);
    expect(s.power).toBe(0);
    // Until it lights up the heading is plain ink: no gradient at all (one browser drew the
    // zero-size fill gradient as solid red).
    expect(await page.locator('[data-spill-text]').evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    expect(s.imprint).toBe(1);

    // Straight away (the first letters let go last) they are still on the paper, under their copies.
    const offsets = await page.evaluate((y) => new Promise<{ n: number[]; d: number[] }>((resolve) => {
      (window as any).__spill.scrollTo(y);
      const look = () => {
        if (!document.querySelector('.crumpled-note')!.hasAttribute('data-spilled')) { requestAnimationFrame(look); return; }
        const real = [...document.querySelectorAll('.crumpled-note .crumpled-note__letter')].map((e) => e.getBoundingClientRect());
        const copy = [...document.querySelectorAll('.letter-spill__letter')].map((e) => e.getBoundingClientRect());
        resolve({ n: [real.length, copy.length], d: real.slice(0, 4).map((r, i) => Math.hypot(r.left + r.width / 2 - (copy[i].left + copy[i].width / 2), r.top + r.height / 2 - (copy[i].top + copy[i].height / 2))) });
      };
      requestAnimationFrame(look);
    }), r.start + 2);
    expect(offsets.n[0]).toBe(offsets.n[1]);
    expect(offsets.n[0]).toBeGreaterThan(20);
    expect(Math.max(...offsets.d)).toBeLessThan(1.5);

    // The real letters stay behind as a gritty grey imprint.
    await page.waitForTimeout(300);
    s = await state(page);
    expect(s.active).toBe(true);
    expect(s.imprint).toBeCloseTo(0.6, 2);
    expect(await page.locator('#spill-grit feTurbulence').count()).toBe(1);
  });

  test('the fall plays by itself, on a clock, and stays down', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await go(page, r.start + 2, 1000); // no scrolling from here on
    const mid = await page.evaluate(() => {
      const note = document.querySelector('.crumpled-note')!.getBoundingClientRect();
      return {
        tip: parseFloat((document.querySelector('.crumpled-note') as HTMLElement).style.getPropertyValue('--tip')),
        below: Math.max(...[...document.querySelectorAll('.letter-spill__letter')].map((e) => e.getBoundingClientRect().top - note.bottom)),
      };
    });
    expect(mid.tip).toBeGreaterThan(9);
    expect(mid.tip).toBeLessThan(13);
    expect(mid.below).toBeGreaterThan(100);

    await expect.poll(async () => parked(await state(page)), { timeout: 15_000, intervals: [250] }).toBe(true);
    const s = await state(page);
    expect(s.spilled).toBe(true);
    expect(s.tip).toBeGreaterThan(10.5);
    expect(s.tip).toBeLessThan(11.5);
    expect(s.boxPowered).toBe(false);
  });

  test('the pull follows the scroll, runs back off-screen on the way up, and never un-tips the paper', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await tip(page, r);

    await go(page, (r.pullStart + r.pullEnd) / 2, 1500);
    let s = await state(page);
    expect(s.copies.some((c) => c.left < s.innerWidth && c.opacity > 0)).toBe(true);
    expect(s.copies.some((c) => c.left > s.innerWidth)).toBe(true); // later letters are still waiting
    expect(s.boxPowered).toBe(false);

    await go(page, r.start + 2, 2000);
    s = await state(page);
    expect(s.copies.every((c) => c.left > s.innerWidth || c.opacity === 1)).toBe(true);
    expect(s.spilled).toBe(true);
    expect(s.tip).toBeGreaterThan(10.5);
    expect(s.boxPowered).toBe(false);
  });

  test('every letter that goes in fills the border a share more and bounces the box; the heading lights only once it is full', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await tip(page, r);

    let before = 0, peak = 0, partial = false;
    const steps = 14;
    for (let k = 1; k <= steps; k++) {
      await go(page, r.pullStart + ((r.pullEnd - r.pullStart) * k) / steps, 0);
      // Watch the box for a moment: it is on a spring, so the bounce shows between frames.
      for (let n = 0; n < 6; n++) { await page.waitForTimeout(45); peak = Math.max(peak, Math.abs((await state(page)).bump)); }
      await page.waitForTimeout(350);
      const s = await state(page);
      const inBox = s.copies.filter((c) => c.opacity === 0).length / s.copies.length;
      expect(s.dashes.length).toBeGreaterThan(0);
      for (const d of s.dashes) {
        // The border is as full as the share of letters inside (each counts in as it enters).
        expect(d, `step ${k}`).toBeGreaterThanOrEqual(inBox - 0.02);
        expect(d, `step ${k}`).toBeLessThan(inBox + 0.2);
        expect(d, `step ${k}`).toBeGreaterThanOrEqual(before - 0.001);
      }
      // The heading stays dark until the box is on.
      if (!s.boxPowered) expect(s.power, `step ${k}`).toBe(0);
      before = s.dashes[0];
      if (before > 0.15 && before < 0.85) { partial = true; expect(s.boxPowered).toBe(false); }
    }
    expect(partial, 'the fill was seen part way').toBe(true);
    expect(peak, 'the box bounced').toBeGreaterThan(3);
    // Then it lights up from its centre in well under a second.
    await expect.poll(async () => lit(await state(page)), { timeout: 1500, intervals: [50] }).toBe(true);
    const end = await state(page);
    expect(end.boxPowered).toBe(true);
    expect(end.textPowered).toBe(true);
    // The spring comes to rest.
    await expect.poll(async () => (await state(page)).bump, { timeout: 3000 }).toBe(0);
  });

  test('when the pull completes the box powers on for good, whatever the scroll does after', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await tip(page, r);

    await go(page, r.pullEnd + 5, 0);
    await expect.poll(async () => lit(await state(page)), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(1000);
    let s = await state(page);
    expect(s.power).toBe(1);
    expect(s.dashes.length).toBeGreaterThan(0);
    for (const d of s.dashes) expect(d).toBeGreaterThanOrEqual(0.999);
    expect(gone(s)).toBe(true);

    await go(page, 0, 1500);
    s = await state(page);
    expect(s.spilled).toBe(true);
    expect(s.power).toBe(1);
    expect(gone(s)).toBe(true);
  });

  // The last frames of the fill round to the same value; the one that marks the box powered must
  // still be drawn (it once was skipped as "unchanged").
  test('the box and the heading get data-powered once lit', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await tip(page, r);
    await go(page, r.pullEnd + 5, 3000);
    const s = await state(page);
    expect(lit(s)).toBe(true);
    expect(s.boxPowered).toBe(true);
    expect(s.textPowered).toBe(true);
    // Fully lit, the heading eases up to a larger size and stays there.
    const scale = () => page.locator('[data-spill-text]').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    await expect.poll(scale, { timeout: 3000 }).toBeCloseTo(1.06, 2);
    await go(page, 0, 800);
    expect(await scale()).toBeCloseTo(1.06, 2);
  });

  test('a jump straight past the end, as the very first scroll, still ends powered within seconds', async ({ page }) => {
    await open(page);
    // No warm-up: the very first scroll goes from the top to past the end of the pull.
    const r = await range(page);
    await go(page, r.pullEnd + 5, 0);
    await expect.poll(async () => lit(await state(page)), { timeout: 9000, intervals: [100] }).toBe(true);
    const s = await state(page);
    expect(s.power).toBe(1);
    expect(s.spilled).toBe(true);
  });

  test('once powered, the send button gets a one-off spotlight when it comes into view', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    await tip(page, r);
    await go(page, r.pullEnd + 5, 0);
    await expect.poll(async () => lit(await state(page)), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(1000);

    const button = page.locator('[data-spill-box] button').first();
    expect(await button.evaluate((b) => b.classList.contains('send-btn-spotlight'))).toBe(false);
    // Bring it fully into view and watch it for the length of the spotlight.
    const seen = await button.evaluate((b: HTMLElement) => new Promise<{ cls: boolean; attr: boolean; maxScale: number; maxWidth: number }>((resolve) => {
      b.scrollIntoView({ block: 'center' });
      const out = { cls: false, attr: false, maxScale: 0, maxWidth: 0 };
      const t0 = performance.now();
      const frame = () => {
        if (b.classList.contains('send-btn-spotlight')) out.cls = true;
        if (b.hasAttribute('data-spotlight')) out.attr = true;
        const m = new DOMMatrixReadOnly(getComputedStyle(b).transform === 'none' ? undefined : getComputedStyle(b).transform);
        out.maxScale = Math.max(out.maxScale, Math.hypot(m.a, m.b));
        out.maxWidth = Math.max(out.maxWidth, b.offsetWidth);
        if (performance.now() - t0 > 3000) resolve(out); else requestAnimationFrame(frame);
      };
      frame();
    }));
    expect(seen.cls).toBe(true);
    expect(seen.attr).toBe(true);
    // The hover look, 30% larger (44 → 56 on hover → 73), as a real size: never scaled up, which would blur it.
    expect(seen.maxWidth).toBeGreaterThanOrEqual(73);
    expect(seen.maxWidth).toBeLessThan(82);
    expect(seen.maxScale).toBeLessThan(1.2);
    await expect.poll(() => button.evaluate((b) => b.classList.contains('send-btn-spotlight') || b.hasAttribute('data-spotlight')), { timeout: 3000 }).toBe(false);
  });

  test('letters leave the screen on the right without ever widening the page', async ({ page }) => {
    await open(page);
    const r = await warm(page);
    let beyond = false;
    for (let k = 0; k <= 24; k++) {
      await go(page, r.start + 2 + ((r.pullEnd - r.start) * k) / 24, 250);
      const m = await state(page);
      if (m.copies.some((c) => c.left > m.innerWidth)) beyond = true;
      expect(m.scrollWidth, `scrollWidth at step ${k}`).toBeLessThanOrEqual(m.innerWidth);
    }
    expect(beyond).toBe(true);
  });

  test('does nothing under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const r = await warm(page);
    await go(page, (r.start + r.pullEnd) / 2, 600);
    await go(page, r.pullEnd + 5, 1500);
    const s = await state(page);
    expect(s.spilled).toBe(false);
    expect(s.active).toBe(false);
    expect(s.imprint).toBe(1);
    expect(s.boxPowered).toBe(false);
  });

  test('works on a phone, where <body> scrolls: spills at the start, powers at the end, stays inside the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const r = await warm(page);
    expect(await page.evaluate(() => document.body.scrollHeight > innerHeight + 1 && getComputedStyle(document.body).overflowY !== 'visible')).toBe(true);
    await go(page, r.start + 2, 500);
    let s = await state(page);
    expect(s.spilled).toBe(true);
    expect(s.active).toBe(true);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.innerWidth);
    await expect.poll(async () => parked(await state(page)), { timeout: 15_000, intervals: [250] }).toBe(true);
    for (let k = 1; k <= 8; k++) {
      await go(page, r.start + 2 + ((r.pullEnd + 5 - r.start - 2) * k) / 8, 200);
      s = await state(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.innerWidth);
    }
    await expect.poll(async () => lit(await state(page)), { timeout: 8000 }).toBe(true);
    s = await state(page);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.innerWidth);
  });
});
