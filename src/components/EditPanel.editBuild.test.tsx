// @vitest-environment jsdom
// The prompt → image → 3D pipeline with a project: the whole edit (image edit,
// then 3D build) runs on the server as one job (/api/edit-job), and the panel
// waits on the project document for its job id.
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
let editJobResponse: { status: number; body: unknown };

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
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/edit-job')).toBe(true));
}

beforeEach(() => {
  sessionStorage.clear();
  projectDoc = { _id: PROJECT, editBuildJobId: 'older', editBuildStatus: 'ready', splatS3Key: 'facelifts/older/output.splat' };
  editJobResponse = { status: 202, body: { jobId: 'job_new', projectId: PROJECT } };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url === '/api/edit-job') return res(editJobResponse.status, editJobResponse.body);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PHOTO = 'edit-images/e1.png';
const PHOTO_URL = '/api/img?key=edit-images%2Fe1.png';
const READY = { editBuildJobId: 'job_new', editBuildStatus: 'ready', editBuildStage: 'building', lastEditImageS3Key: PHOTO, splatS3Key: 'facelifts/job_new/output.splat' };

describe('EditPanel server-driven edits', () => {
  it('sends the whole edit as one job, shows the photo when the job moves on to the 3D build, then the head', async () => {
    const { onPlyReady, onImageUpdated } = renderPanel();
    await submit();

    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/edit-job')![1].body);
    expect(body).toMatchObject({ projectId: PROJECT, prompt: 'short fade', imageUrl: '/api/img?key=pictures/a/scan.png', fingerprint: 'fp_test' });
    // The server drives both halves (and the GPU warmup): the browser makes no other call.
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/edit-job']);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(`shapeup-pipeline:${PROJECT}`) ?? '{}').jobId).toBe('job_new'));

    // The previous edit's finished state is not ours: nothing is shown yet.
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'building', editBuildStage: 'editing', lastEditImageS3Key: 'edit-images/older.png' });
    expect(onImageUpdated).not.toHaveBeenCalled();

    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'building', editBuildStage: 'building', lastEditImageS3Key: PHOTO });
    await waitFor(() => expect(onImageUpdated).toHaveBeenCalledWith(PHOTO_URL, PHOTO));
    expect(onPlyReady).not.toHaveBeenCalled();

    setDoc(READY);
    await waitFor(() => expect(onPlyReady).toHaveBeenCalledWith('/api/splat?key=facelifts%2Fjob_new%2Foutput.splat', 'facelifts/job_new/output.splat'));
    expect(onImageUpdated).toHaveBeenCalledTimes(1);
  });

  it('a live query that skips the hand-off still shows the photo, before the head', async () => {
    const { onPlyReady, onImageUpdated } = renderPanel();
    await submit();
    setDoc(READY);
    await waitFor(() => expect(onPlyReady).toHaveBeenCalled());
    expect(onImageUpdated).toHaveBeenCalledWith(PHOTO_URL, PHOTO);
    expect(onImageUpdated.mock.invocationCallOrder[0]).toBeLessThan(onPlyReady.mock.invocationCallOrder[0]);
  });

  it("shows the server's user-safe error when the edit fails, and no photo if the image model never made one", async () => {
    const { onPlyReady, onImageUpdated } = renderPanel();
    await submit();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'failed', editBuildStage: 'editing', editBuildError: "We couldn't create that look. Please try again." });
    await waitFor(() => expect(screen.getByText(/couldn't create that look/)).toBeInTheDocument());
    expect(onPlyReady).not.toHaveBeenCalled();
    expect(onImageUpdated).not.toHaveBeenCalled();
  });

  it('opens pricing on 402 instead of waiting', async () => {
    editJobResponse = { status: 402, body: { error: 'Out of credits', needsCredits: true } };
    const { onPlyReady } = renderPanel();
    await submit();
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(`shapeup-pipeline:${PROJECT}`) ?? '{}').jobId).toBeUndefined();
  });

  it("shows the route's own message when the job is refused up front", async () => {
    editJobResponse = { status: 400, body: { error: 'Invalid haircut reference: unsupported image type' } };
    renderPanel();
    await submit();
    await waitFor(() => expect(screen.getByText(/Invalid haircut reference/)).toBeInTheDocument());
  });

  it('after a refresh mid-build, reconnects to the saved job and delivers it', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'hairstep', sketchProgress: 100, hairstepProgress: 40, startedAt: Date.now(), jobId: 'job_new' }));
    projectDoc = { _id: PROJECT, editBuildJobId: 'job_new', editBuildStatus: 'building' };
    const { onPlyReady } = renderPanel();
    await act(async () => {});
    expect(onPlyReady).not.toHaveBeenCalled();
    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'ready', splatS3Key: 'facelifts/job_new/output.splat' });
    await waitFor(() => expect(onPlyReady).toHaveBeenCalledWith(expect.stringContaining('job_new'), 'facelifts/job_new/output.splat'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('after a refresh during the image edit, reconnects too: the photo, then the head', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'sketch', sketchProgress: 30, hairstepProgress: 0, startedAt: Date.now(), prompt: 'short fade', jobId: 'job_new' }));
    projectDoc = { _id: PROJECT, editBuildJobId: 'job_new', editBuildStatus: 'building', editBuildStage: 'editing' };
    const { onPlyReady, onImageUpdated } = renderPanel();
    await act(async () => {});
    expect(screen.queryByText(/interrupted by the refresh/)).not.toBeInTheDocument();

    setDoc({ editBuildJobId: 'job_new', editBuildStatus: 'building', editBuildStage: 'building', lastEditImageS3Key: PHOTO });
    await waitFor(() => expect(onImageUpdated).toHaveBeenCalledWith(PHOTO_URL, PHOTO));
    setDoc(READY);
    await waitFor(() => expect(onPlyReady).toHaveBeenCalledWith(expect.stringContaining('job_new'), 'facelifts/job_new/output.splat'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('after a refresh that beat the edit request to the server, asks to try again', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'hairstep', sketchProgress: 100, hairstepProgress: 5, startedAt: Date.now() }));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/interrupted by the refresh/)).toBeInTheDocument());
  });

  it('...and during the image edit, puts the prompt back so it can be resent', async () => {
    sessionStorage.setItem(`shapeup-pipeline:${PROJECT}`, JSON.stringify({ phase: 'sketch', sketchProgress: 10, hairstepProgress: 0, startedAt: Date.now(), prompt: 'buzz cut' }));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/interrupted by the refresh/)).toBeInTheDocument());
    expect(screen.getByLabelText('Describe the haircut you want')).toHaveValue('buzz cut');
  });
});
