import { expect, test, type Locator } from '@playwright/test';

// "How it works" follows one guy: his selfie (step 1), the cuts he texts for (step 2), and his
// head wearing each one in 3D (step 3). Every clip in step 3 turns on the same schedule, so
// pressing send swaps the cut without the head jumping to another angle.

const playing = (v: Locator) => v.evaluate((el: HTMLVideoElement) => !el.paused && el.currentTime > 0);
const shown = (v: Locator) => v.evaluate((el) => getComputedStyle(el).opacity === '1');

test('pressing send swaps step 3 to the requested cut, mid-turn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const steps = page.locator('#how-it-works');
  await steps.scrollIntoViewIfNeeded();

  // Step 1 is his selfie.
  await expect(steps.getByAltText('Scan your face')).toHaveAttribute('src', /face1_selfie/);

  // Step 3 starts on his own hair; the eight cuts wait behind it, loaded and hidden.
  const clips = steps.locator('video');
  await expect(clips).toHaveCount(9);
  const idle = clips.nth(0);
  await expect(idle).toHaveAttribute('src', '/landing_face1/face1.mp4');
  await expect.poll(() => playing(idle)).toBe(true);
  await expect.poll(() => clips.evaluateAll((vs: HTMLVideoElement[]) => vs.every((v) => v.readyState >= 3 && Math.abs(v.duration - 1.2) < 0.01)), { timeout: 20_000 }).toBe(true);
  await expect(steps.getByText('your current cut')).toBeVisible();
  // Each cut has been played for an instant behind the idle clip, so the first swap to it is as
  // quick as any later one; they are left paused and hidden.
  await expect.poll(() => clips.evaluateAll((vs: HTMLVideoElement[]) => vs.slice(1).every((v) => v.played.length > 0 && v.paused))).toBe(true);
  await expect.poll(() => playing(idle)).toBe(true);

  const send = steps.getByRole('button', { name: 'Send' });
  const requests = ['Give me a middle part', 'Messy, platinum blonde', 'Curly mop on top'];
  let before = idle;
  for (const [i, request] of requests.entries()) {
    const next = clips.nth(i + 1);
    // Where the turn is when send is pressed, and where the next clip picks it up.
    const handover = await send.evaluate((btn: HTMLButtonElement, [from, to]) => new Promise<{ from: number; to: number }>((resolve) => {
      const a = document.querySelectorAll<HTMLVideoElement>('#how-it-works video')[from];
      const b = document.querySelectorAll<HTMLVideoElement>('#how-it-works video')[to];
      b.addEventListener('playing', () => resolve({ from: a.currentTime, to: b.currentTime }), { once: true });
      btn.click();
    }), [i, i + 1]);
    // The clip it left is stopped at the moment of the swap; the new one starts within a frame of it.
    expect(Math.abs(handover.to - handover.from)).toBeLessThan(0.05);

    await expect.poll(() => shown(next)).toBe(true);
    await expect.poll(() => playing(next)).toBe(true);
    await expect.poll(() => shown(before)).toBe(false);
    expect(await before.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
    // Step 2 shows the text that was sent, and step 3 names it.
    await expect(steps.getByText(`“${request}”`)).toBeVisible();
    before = next;
  }
});

test('the step 3 clips stay inside their card on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const steps = page.locator('#how-it-works');
  await steps.scrollIntoViewIfNeeded();
  const idle = steps.locator('video').first();
  await idle.scrollIntoViewIfNeeded();
  await expect.poll(() => playing(idle)).toBe(true);
  const box = await idle.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// Hovering the send button makes it larger by changing its real size, not by scaling it, so its
// circle, ring and arrow stay sharp.
test('the send button grows on hover without being scaled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const send = page.locator('#how-it-works').getByRole('button', { name: 'Send' });
  // The button pulses while idle, so it never counts as "stable": scroll and point by hand, and
  // again if the page was still settling under the pointer.
  await send.evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await expect(async () => {
    const box = (await send.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600); // the growth has settled
    expect(await send.evaluate((b: HTMLElement) => b.offsetWidth)).toBe(56);
  }).toPass({ timeout: 15_000 });
  const look = await send.evaluate((b: HTMLElement) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(b).transform);
    const arrow = b.querySelector('svg:last-of-type')!.getBoundingClientRect();
    return { scale: Math.hypot(m.a, m.b), arrow: Math.round(arrow.width) };
  });
  expect(look.scale).toBeCloseTo(1, 2);   // tilted, not scaled
  expect(look.arrow).toBeGreaterThan(21); // the arrow is drawn larger too (17px at rest)
  await page.mouse.move(5, 5);
  await expect.poll(() => send.evaluate((b: HTMLElement) => b.offsetWidth)).toBe(44);
});
