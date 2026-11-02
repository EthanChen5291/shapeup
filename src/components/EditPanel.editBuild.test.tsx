// @vitest-environment jsdom
// The prompt → image → 3D pipeline with a project: the edit build runs on the
// server and the panel waits on the project document for its job id.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// api.* references become their dotted names, so the mocks can tell them apart.
vi.mock('@convex/_generated/api', () => {
  const ref = (path: string[]): unknown => new Proxy({}, {
    get: (_t, k) => (k === Symbol.toPrimitive || k === 'toString' ? () => path.join('.') : ref([...path, String(k)])),
  });
  return { api: ref(['api']) };
});
let projectDoc: Record<string, unknown> | null = null;
let rerender: (() => void) | null = null;
vi.mock('convex/react', () => ({
  useQuery: (fn: unknown, args: unknown) => (String(fn) === 'api.projects.get' && args !== 'skip' ? projectDoc : undefined),
  useMutation: () => vi.fn(async () => ({ jobId: 'station_1' })),
}));
vi.mock('@/lib/visitorId', () => ({ getVisitorId: async () => 'fp_test' }));

import EditPanel from './EditPanel';
import { mockUserHeadProfile } from '@/data/mockProfile';

const PROJECT = 'p1';
let fetchMock: ReturnType<typeof vi.fn>;
let faceliftResponse: { status: number; body: unknown };

function setDoc(next: Record<string, unknown>) {
  projectDoc = { _id: PROJECT, ...next };
  act(() => rerender?.());
}

function renderPanel(props: Partial<React.ComponentProps<typeof EditPanel>> = {}) {
  const onPlyReady = vi.fn();
  const onImageUpdated = vi.fn();
  const element = () => (
    <EditPanel
      profile={mockUserHeadProfile}
      onParamsChange={() => {}}
      sessionId="s1"
      latestImageUrl="/api/img?key=pictures/a/scan.png"
      onImageUpdated={onImageUpdated}
      onPlyReady={onPlyReady}
      paywallDisabled
      projectId={PROJECT}
      {...props}
    />
  );
  const view = render(element());
  rerender = () => view.rerender(element());
  return { onPlyReady, onImageUpdated };
}

async function submit(prompt = 'short fade') {
  fireEvent.change(screen.getByLabelText('Describe the haircut you want'), { target: { value: prompt } });
  fireEvent.click(screen.getByLabelText('Apply hair edit request'));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/facelift')).toBe(true));
}

beforeEach(() => {
  sessionStorage.clear();
  projectDoc = { _id: PROJECT, editBuildJobId: 'older', editBuildStatus: 'ready', splatS3Key: 'facelifts/older/output.splat' };
  faceliftResponse = { status: 202, body: { jobId: 'job_new', projectId: PROJECT } };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url === '/api/facelift/warmup') return res(200, {});
    if (url === '/api/gemini-hair-edit') return res(200, { ok: true, newImageUrl: 'data:image/png;base64,AAA', editImageS3Key: 'edit-images/e1.png' });
    if (url === '/api/facelift') return res(faceliftResponse.status, faceliftResponse.body);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EditPanel server-driven edit builds', () => {
  it('starts an async edit build and shows the head once the project reports our job ready', async () => {
    const { onPlyReady, onImageUpdated } = renderPanel();
    await submit();

    // The route saved the edit image itself, so the studio needn't upload it.
    expect(onImageUpdated).toHaveBeenCalledWith('data:image/png;base64,AAA', 'edit-images/e1.png');
    const geminiBody = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/gemini-hair-edit')![1].body);
    expect(geminiBody.projectId).toBe(PROJECT);
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/facelift')![1].body);
    expect(body).toMatchObject({ async: true, mode: 'edit', projectId: PROJECT, prompt: 'short fade' });

    // The previous edit's finished state is not ours: nothing is shown yet.
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(`shapeup-pipeline:${PROJECT}`) ?? '{}').jobId).toBe('job_new'));

    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'building' });
    expect(onPlyReady).not.toHaveBeenCalled();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'ready', splatS3Key: 'facelifts/job_new/output.splat' });
    await waitFor(() => expect(onPlyReady).toHaveBeenCalledWith('/api/proxy-ply?key=facelifts%2Fjob_new%2Foutput.splat', 'facelifts/job_new/output.splat'));
  });

  it("shows the server's user-safe error when the edit build fails", async () => {
    const { onPlyReady } = renderPanel();
    await submit();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'failed', editBuildError: 'Our 3D builder is busy right now. Please try again in a few minutes.' });
    await waitFor(() => expect(screen.getByText(/builder is busy/)).toBeInTheDocument());
    expect(onPlyReady).not.toHaveBeenCalled();
  });

  it('opens pricing on 402 instead of waiting', async () => {
    faceliftResponse = { status: 402, body: { error: 'Out of credits', needsCredits: true } };
    const { onPlyReady } = renderPanel();
    await submit();
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
  });

  it('after a refresh mid-build, reconnects to the saved job and delivers it', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'hairstep', sketchProgress: 100, hairstepProgress: 40, startedAt: Date.now(), jobId: 'job_new' }));
    projectDoc = { _id: PROJECT, editBuildJobId: 'job_new', editBuildStatus: 'building' };
    const { onPlyReady } = renderPanel();
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'ready', splatS3Key: 'facelifts/job_new/output.splat' });
    await waitFor(() => expect(onPlyReady).toHaveBeenCalledWith(expect.stringContaining('job_new'), 'facelifts/job_new/output.splat'));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/facelift', expect.anything());
  });

  it('after a refresh that beat the build request to the server, asks to try again', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'hairstep', sketchProgress: 100, hairstepProgress: 5, startedAt: Date.now() }));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/interrupted by the refresh/)).toBeInTheDocument());
  });
});
