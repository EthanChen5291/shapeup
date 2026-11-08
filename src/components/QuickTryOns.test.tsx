// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Id } from '@convex/_generated/dataModel';

vi.mock('@convex/_generated/api', () => ({ api: { projects: { setTryOnBase: 'projects:setTryOnBase', setTryOnSelection: 'projects:setTryOnSelection' }, prebakeCalibrations: { submit: 'prebakeCalibrations:submit', latestForCut: 'prebakeCalibrations:latestForCut' } } }));
const setTryOnBaseMock = vi.fn(async () => {});
const setTryOnSelectionMock = vi.fn(async () => {});
vi.mock('convex/react', () => ({
  useMutation: (fn: string) => (fn === 'projects:setTryOnSelection' ? setTryOnSelectionMock : setTryOnBaseMock),
  useQuery: () => undefined,
}));
vi.mock('@/lib/visitorId', () => ({ getVisitorId: async () => 'fp_test' }));
// The viewer's "fully streamed" signal: tests fire it by hand.
let splatLoadedCb: (() => void) | undefined;
vi.mock('@/hooks/useSplatLoaded', () => ({ useSplatLoaded: (src: string | null, cb: () => void) => { if (src) splatLoadedCb = cb; } }));

import { QuickTryOnsPanel, QuickTryOnsToggle, listedCuts, neighbourCuts, pillOutlinePath, useQuickTryOns } from './QuickTryOns';
import { PRESET_CATEGORIES } from '@/data/hairPresets';
import { PREBAKE_DEFAULT_TRANSFORM } from '@/lib/splatMerge';

function QuickTryOns(props: Parameters<typeof useQuickTryOns>[0]) {
  const state = useQuickTryOns(props);
  return <><QuickTryOnsToggle state={state} /><QuickTryOnsPanel state={state} /></>;
}

const PROJECT = 'p1' as Id<'projects'>;
// Blob URLs are minted in order: the raw base bytes first; then, when the default
// head-density gain is not 1, a gained copy that the buzz-cut view shows; then merged styles.
const GAINED = PREBAKE_DEFAULT_TRANSFORM.headAlpha !== 1 ? 1 : 0;
const BASE_VIEW = `blob:${1 + GAINED}`;
const FIRST_STYLE = `blob:${2 + GAINED}`;
const splat = (rows: number) => new ArrayBuffer(rows * 32);

let fetchMock: ReturnType<typeof vi.fn>;
let blobCount = 0;

beforeEach(() => {
  blobCount = 0;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
    if (url.startsWith('/api/splat')) return url.includes('meta.json') ? ok({}) : ok(splat(3));
    // No compressed twin published in these tests: the loader falls back to the .splat.
    if (url.endsWith('.spz')) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (url.startsWith('/prebake/')) return ok(splat(2));
    if (url === '/api/facelift/warmup') return ok({});
    if (url === '/api/gemini-hair-edit') return ok({ ok: true, newImageUrl: 'data:image/png;base64,AAA' });
    if (url === '/api/facelift') return ok({ splatS3Key: 'facelifts/job_buzz/output.splat', metaS3Key: 'facelifts/job_buzz/meta.json' });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => `blob:${++blobCount}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setTryOnBaseMock.mockClear();
  setTryOnSelectionMock.mockClear();
});

const calls = (prefix: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(prefix) && !String(u).endsWith('.spz')).length;

describe('saved try-on style', () => {
  const men = PRESET_CATEGORIES.find((c) => c.id === 'man')!;
  const firstCut = listedCuts(men)[0];
  const firstVariant = firstCut.variants[0];
  const BASE = 'facelifts/job_old/output.splat';

  it('saves the chosen style on the project, and clears it when try-ons are turned off', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key={BASE} onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${firstCut.name}`) }));
    await waitFor(() => expect(setTryOnSelectionMock).toHaveBeenCalledWith({ projectId: PROJECT, variantId: firstVariant.id }));

    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    expect(setTryOnSelectionMock).toHaveBeenLastCalledWith({ projectId: PROJECT, variantId: null });
    expect(onViewChange).toHaveBeenLastCalledWith(null);
  });

  it('reopening a project shows its saved style without a tap, and does not re-save it', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key={BASE} savedVariantId={firstVariant.id} onViewChange={onViewChange} />);
    // Straight to the merged style (the plain buzz-cut view is skipped on the way).
    await waitFor(() => expect(calls('/prebake/')).toBe(1));
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: expect.stringMatching(/^blob:/), meta: null }));
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Quick try-ons' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls('/api/splat')).toBe(1); // the saved base, no rebuild
    expect(setTryOnSelectionMock).not.toHaveBeenCalled();
  });

  it('a saved style that is no longer offered leaves try-ons off', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key={BASE} savedVariantId="retired-style" onViewChange={onViewChange} />);
    await act(async () => {});
    expect(onViewChange).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Quick try-ons' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('neighbourCuts', () => {
  const men = PRESET_CATEGORIES.find((c) => c.id === 'man')!;
  const cuts = listedCuts(men);

  it('lists cuts in section order with hidden ones skipped and no duplicates', () => {
    expect(cuts.length).toBeGreaterThan(4);
    expect(cuts.every((c) => !c.hidden)).toBe(true);
    expect(new Set(cuts.map((c) => c.id)).size).toBe(cuts.length);
  });

  it('returns the cuts on either side, nearest first, clipped at the list ends', () => {
    expect(neighbourCuts(men, cuts[0].id, 2).map((c) => c.id)).toEqual([cuts[1].id, cuts[2].id]);
    expect(neighbourCuts(men, cuts[2].id, 2).map((c) => c.id)).toEqual([cuts[3].id, cuts[1].id, cuts[4].id, cuts[0].id]);
    const last = cuts[cuts.length - 1];
    expect(neighbourCuts(men, last.id, 2).map((c) => c.id)).toEqual([cuts[cuts.length - 2].id, cuts[cuts.length - 3].id]);
  });

  it('is empty for a cut that is not listed', () => {
    expect(neighbourCuts(men, 'nope')).toEqual([]);
    expect(neighbourCuts(men, 'dreads')).toEqual([]); // hidden hand cut
  });
});

describe('pillOutlinePath', () => {
  it('starts at top centre and runs counter-clockwise (left first) back to it', () => {
    // 200×40 pill, inset 1 → radius 19.
    expect(pillOutlinePath(200, 40, 1)).toBe(
      'M 100 1 L 20 1 A 19 19 0 0 0 1 20 L 1 20 A 19 19 0 0 0 20 39 L 180 39 A 19 19 0 0 0 199 20 L 199 20 A 19 19 0 0 0 180 1 L 100 1',
    );
  });

  it('follows a rounded square when given a corner radius', () => {
    expect(pillOutlinePath(60, 60, 2, 14)).toBe(
      'M 30 2 L 16 2 A 14 14 0 0 0 2 16 L 2 44 A 14 14 0 0 0 16 58 L 44 58 A 14 14 0 0 0 58 44 L 58 16 A 14 14 0 0 0 44 2 L 30 2',
    );
  });
});

describe('QuickTryOns', () => {
  it('reuses a saved buzz-cut base: no edit or GPU build, just loads it', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/api/img?key=x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: BASE_VIEW, meta: null }));
    expect(calls('/api/gemini-hair-edit')).toBe(0);
    expect(calls('/api/facelift')).toBe(0);
    expect(screen.getByRole('button', { name: 'Quick try-ons' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('first press builds the buzz cut (edit → 3D) with a progress bar on the button, then remembers it', async () => {
    const onViewChange = vi.fn();
    let finishEdit!: () => void;
    const editGate = new Promise<void>((r) => { finishEdit = r; });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/gemini-hair-edit') await editGate;
      return base(input);
    });
    render(<QuickTryOns projectId={PROJECT} imageUrl="/api/img?key=selfie" onViewChange={onViewChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buzzing your hair/i })).toBeDisabled();

    await act(async () => { finishEdit(); });
    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith({ src: BASE_VIEW, meta: null }));

    const editBody = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/gemini-hair-edit')![1].body);
    expect(editBody.imageUrl).toBe('/api/img?key=selfie');
    expect(editBody.prompt).toMatch(/buzz cut/i);
    const buildBody = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/facelift')![1].body);
    expect(buildBody).not.toHaveProperty('projectId'); // must never overwrite the main head
    expect(setTryOnBaseMock).toHaveBeenCalledWith({
      projectId: PROJECT, splatS3Key: 'facelifts/job_buzz/output.splat', metaS3Key: 'facelifts/job_buzz/meta.json',
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('warms the first cuts when the list shows and a hovered cut on demand', async () => {
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    const middlePart = await screen.findByRole('button', { name: /^Middle Part/ });
    // Prefetches target the compressed twin at low priority; the idle scheduler is a timeout in jsdom.
    const warmed = () => fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith('.spz') && (init as RequestInit | undefined)?.priority === 'low').map(([u]) => String(u));
    await waitFor(() => expect(warmed().length).toBeGreaterThanOrEqual(4));
    const men = PRESET_CATEGORIES.find((c) => c.id === 'man')!;
    expect(warmed()).toContain(men.cuts.filter((c) => !c.hidden)[0].variants[0].splatUrl.replace(/\.splat$/, '.spz'));
    const before = warmed().length;
    fireEvent.pointerEnter(middlePart);
    await waitFor(() => expect(warmed().length).toBeGreaterThan(before));
    expect(calls('/prebake/')).toBe(0); // nothing was actually chosen
  });

  it('choosing a cut warms the default colour of the cuts listed around it', async () => {
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Middle Part/ }));
    const men = PRESET_CATEGORIES.find((c) => c.id === 'man')!;
    const chosen = listedCuts(men).find((c) => c.name === 'Middle Part')!;
    const neighbours = neighbourCuts(men, chosen.id);
    expect(neighbours.length).toBeGreaterThan(0);
    const warmed = () => fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith('.spz') && (init as RequestInit | undefined)?.priority === 'low').map(([u]) => String(u));
    for (const n of neighbours) {
      await waitFor(() => expect(warmed()).toContain(n.variants[0].splatUrl.replace(/\.splat$/, '.spz')));
    }
  });

  it('shows a loading ring on the swatch while a style downloads, then keeps it full as the selection mark', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Middle Part/ }));
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: FIRST_STYLE, meta: null }));
    // Merged and handed to the viewer: the ring sits at 90% until the splat streams in.
    const ring = screen.getByRole('progressbar', { name: 'Loading style' });
    expect(ring).toHaveAttribute('aria-valuenow', '90');
    expect(ring.closest('button')).toHaveClass('is-loading');
    expect(splatLoadedCb).toBeDefined();
    act(() => splatLoadedCb!());
    // Loaded: no longer a progress bar, but the ring stays on the selected swatch, full.
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Loading style' })).toBeNull());
    const fill = ring.closest('button')!.querySelector('.tryon-swatch-ring-fill');
    expect(fill).toHaveAttribute('stroke-dasharray', '100 100');
    expect(ring.closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('picking a style merges it onto the base once, then reuses the merged splat', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    const middlePart = await screen.findByRole('button', { name: /^Middle Part/ });

    fireEvent.click(middlePart);
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: FIRST_STYLE, meta: null }));
    // The chosen colour once, plus the cut's other colours warmed into the worker's cache.
    const cut = PRESET_CATEGORIES.find((c) => c.id === 'man')!.cuts.find((c) => c.name === 'Middle Part')!;
    await waitFor(() => expect(calls('/prebake/')).toBe(cut.variants.length));
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === cut.variants[0].splatUrl)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^Buzz cut/ }));
    expect(onViewChange).toHaveBeenLastCalledWith({ src: BASE_VIEW, meta: null });
    fireEvent.click(middlePart);
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: FIRST_STYLE, meta: null }));
    expect(calls('/prebake/')).toBe(cut.variants.length); // cached, no refetch / re-merge
  });

  it('a cached style still shows a quick ring: the swap is not instant on screen', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    const middlePart = await screen.findByRole('button', { name: /^Middle Part/ });
    fireEvent.click(middlePart);
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: FIRST_STYLE, meta: null }));
    act(() => splatLoadedCb!());
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Loading style' })).toBeNull());

    // Back to the base, then the same (now cached) style again.
    fireEvent.click(screen.getByRole('button', { name: /^Buzz cut/ }));
    fireEvent.click(middlePart);
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: FIRST_STYLE, meta: null }));
    const ring = screen.getByRole('progressbar', { name: 'Loading style' });
    expect(ring).toHaveAttribute('aria-valuenow', '90');
    // The viewer reports loaded at once (in-memory cache), but the ring holds for its minimum time…
    act(() => splatLoadedCb!());
    expect(screen.getByRole('progressbar', { name: 'Loading style' })).toBeInTheDocument();
    // …then clears.
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Loading style' })).toBeNull(), { timeout: 1500 });
  });

  it('retries the base download once after a 5xx (a sign-in-service blip), then loads', async () => {
    let baseCalls = 0;
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/splat') && url.includes('output.splat') && ++baseCalls === 1) {
        return { ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return inner(input);
    });
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith({ src: BASE_VIEW, meta: null }), { timeout: 3000 });
    expect(baseCalls).toBe(2);
    expect(screen.queryByText(/retry/i)).toBeNull();
  });

  it('pressing again turns try-ons off and restores the normal head', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    const toggle = screen.getByRole('button', { name: 'Quick try-ons' });
    fireEvent.click(toggle);
    await screen.findByRole('button', { name: /^Middle Part/ });
    fireEvent.click(toggle);
    expect(onViewChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: /^Middle Part/ })).toBeNull();
  });

  it('shows a retry state when the build fails', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }));
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" onViewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    expect(await screen.findByRole('button', { name: /tap to retry/i })).toBeEnabled();
  });
});

describe('QuickTryOnsPanel (toolbox list)', () => {
  it('lists cuts with their descriptions; back leaves try-ons', async () => {
    const onViewChange = vi.fn();
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    const item = await screen.findByRole('button', { name: /^Middle Part/ });
    expect(item).toHaveTextContent('straight curtains');

    fireEvent.click(screen.getByRole('button', { name: 'Back from Quick try-ons' }));
    expect(onViewChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: /^Middle Part/ })).toBeNull();
  });

  it('switches between men’s and women’s cuts with the gender toggle', async () => {
    render(<QuickTryOns projectId={PROJECT} imageUrl="/x" baseSplatS3Key="facelifts/job_old/output.splat" onViewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick try-ons' }));
    await screen.findByRole('button', { name: /^Middle Part/ });
    fireEvent.click(screen.getByRole('button', { name: /switch to women’s/ }));
    expect(await screen.findByRole('button', { name: /^Layered Bob/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Middle Part/ })).toBeNull();
  });

  it('shows a retry under a style that failed to load; tapping it picks that style again', () => {
    const man = PRESET_CATEGORIES.find((c) => c.id === 'man')!;
    const cut = man.cuts[0];
    const choose = vi.fn();
    const state = {
      phase: 'on', gender: 'man', setGender: vi.fn(), selected: null, merging: false, toggle: vi.fn(), choose,
      styleError: { variantId: cut.variants[0].id, message: 'fetch failed' },
    } as unknown as Parameters<typeof QuickTryOnsPanel>[0]['state'];
    render(<QuickTryOnsPanel state={state} />);
    const retry = screen.getByRole('status');
    expect(retry).toHaveTextContent('Couldn’t load: tap to retry');
    fireEvent.click(retry);
    expect(choose).toHaveBeenCalledWith(cut.variants[0]);
    expect(screen.getAllByRole('status')).toHaveLength(1); // only the failed cut
  });
});

describe('QuickTryOnsPanel: sections, search and colours', () => {
  const panelState = (overrides: Record<string, unknown> = {}) => ({
    phase: 'on', gender: 'man', setGender: vi.fn(), selected: null, merging: false, toggle: vi.fn(), choose: vi.fn(),
    styleError: null, ...overrides,
  }) as unknown as Parameters<typeof QuickTryOnsPanel>[0]['state'];

  it('groups men’s cuts under headings and never lists hidden hand-cut styles', () => {
    render(<QuickTryOnsPanel state={panelState()} />);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Short', 'Medium', 'Long', 'Curls & coils', 'Tied back']);
    expect(screen.getByRole('button', { name: /^Wolf Cut/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Dreads/ })).toBeNull();          // superseded by Locs
    expect(screen.getAllByRole('button', { name: /^Middle Part/ })).toHaveLength(1); // only the catalog one
  });

  it('search filters to a flat list, shows an empty state, and Escape restores the sections', () => {
    render(<QuickTryOnsPanel state={panelState()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search try-on styles' }));
    const input = screen.getByRole('searchbox', { name: 'Search try-on styles' });

    fireEvent.change(input, { target: { value: 'wolf' } });
    expect(screen.getByRole('button', { name: /^Wolf Cut/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Middle Part/ })).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Buzz cut/ })).toBeNull();

    fireEvent.change(input, { target: { value: 'curls' } });                         // section names match too
    expect(screen.getByRole('button', { name: /^Afro/ })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByRole('status')).toHaveTextContent('No styles match “zzz”');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(1);
  });

  it('the selected cut shows its six colours by name and switches colour on tap', () => {
    const cut = PRESET_CATEGORIES.find((c) => c.id === 'woman')!.cuts.find((c) => c.id === 'f-butterfly')!;
    const choose = vi.fn();
    render(<QuickTryOnsPanel state={panelState({ gender: 'woman', selected: cut.variants[2], choose })} />);
    const colours = screen.getByRole('group', { name: 'Hair colour' });
    const swatches = colours.querySelectorAll('button');
    expect([...swatches].map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Espresso', 'Mocha', 'Caramel Balayage', 'Honey Blonde', 'Copper', 'Cherry Cola']);
    expect(colours).toHaveTextContent('Caramel Balayage');                          // the selected colour, in words
    expect(swatches[2]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(swatches[4]);
    expect(choose).toHaveBeenCalledWith(cut.variants[4]);
  });
});
