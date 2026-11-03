// @vitest-environment jsdom
// Hook-level behaviour added for calibration: failed style loads keep the previous
// style, and slider drags only re-merge on release.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Id } from '@convex/_generated/dataModel';

vi.mock('@convex/_generated/api', () => ({ api: { projects: { setTryOnBase: 'projects:setTryOnBase' }, prebakeCalibrations: { submit: 'prebakeCalibrations:submit', latestForCut: 'prebakeCalibrations:latestForCut' } } }));
vi.mock('convex/react', () => ({ useMutation: () => vi.fn(async () => {}), useQuery: () => undefined }));
vi.mock('@/lib/visitorId', () => ({ getVisitorId: async () => 'fp_test' }));

import { QuickTryOnsPanel, QuickTryOnsToggle, useQuickTryOns, type QuickTryOnsState } from './QuickTryOns';

const PROJECT = 'p1' as Id<'projects'>;
let latest: QuickTryOnsState | null = null;
function Harness(props: Parameters<typeof useQuickTryOns>[0]) {
  const state = useQuickTryOns(props);
  latest = state;
  return <><QuickTryOnsToggle state={state} /><QuickTryOnsPanel state={state} /></>;
}

let failPrebake = (_url: string) => false;
let prebakeFetches = 0;
let blobCount = 0;

beforeEach(() => {
  latest = null; blobCount = 0; prebakeFetches = 0; failPrebake = () => false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
    if (url.startsWith('/api/proxy-ply')) return url.includes('meta.json') ? ok({}) : ok(new ArrayBuffer(3 * 32));
    if (url.endsWith('.spz')) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (url.startsWith('/prebake/')) {
      prebakeFetches++;
      if (failPrebake(url)) throw new TypeError('Failed to fetch');
      return ok(new ArrayBuffer(2 * 32));
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  URL.createObjectURL = vi.fn(() => `blob:${++blobCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function openWithBase(onViewChange = vi.fn(), calibrate = false) {
  render(<Harness projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} calibrate={calibrate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
  await screen.findByRole('button', { name: /^Middle Part/ });
  return onViewChange;
}

describe('useQuickTryOns — calibration behaviour', () => {
  it('keeps the current style on screen when another style fails to load (no silent snap to the buzz cut)', async () => {
    const onViewChange = await openWithBase();
    fireEvent.click(screen.getByRole('button', { name: /^Middle Part/ }));
    await waitFor(() => expect(latest?.selected?.id).toMatch(/^m-middlepart_/));
    const shown = onViewChange.mock.calls.at(-1)![0];

    failPrebake = (u) => !u.endsWith('/men/middlepart-darkbrown.splat');
    fireEvent.click(screen.getByRole('button', { name: /^Wavy Middle Part/ }));
    await waitFor(() => expect(latest?.styleError?.message).toMatch(/Failed to fetch/));
    expect(onViewChange.mock.calls.at(-1)![0]).toEqual(shown);   // view unchanged
    expect(latest?.selected?.id).toMatch(/^m-middlepart_/);         // selection restored
  });

  it('slider drags update the value live but only re-merge on commit', async () => {
    const onViewChange = await openWithBase(vi.fn(), true);
    fireEvent.click(screen.getByRole('button', { name: /^Middle Part/ }));
    await waitFor(() => expect(latest?.transform).not.toBeNull());
    const viewsBefore = onViewChange.mock.calls.length;

    vi.useFakeTimers();
    act(() => { latest!.setTransform({ scale: 2.4 }, { merge: false }); });
    act(() => { latest!.setTransform({ scale: 2.5 }, { merge: false }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(latest!.transform?.scale).toBe(2.5);
    expect(onViewChange.mock.calls.length).toBe(viewsBefore);      // no re-merge while dragging

    act(() => { latest!.commitTransform(); });
    await act(async () => { vi.advanceTimersByTime(500); });
    vi.useRealTimers();
    await waitFor(() => expect(onViewChange.mock.calls.length).toBe(viewsBefore + 1));
  });
});
