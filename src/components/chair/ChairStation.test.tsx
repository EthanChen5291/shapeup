// @vitest-environment jsdom

// The chair's phase machine, walked the way the person in the chair walks it.
//
// This covers the flow itself — name → consent → stage → review → saved —
// with the camera, the model and the frame decoder stubbed. Those three
// are the parts that genuinely need a browser; everything between them is
// decision logic, and it's the decisions that hurt when they're wrong: a take
// starting before consent, a take starting before anyone asked for one (which
// is money), a retry losing the client, a "yes" that saves nothing, a "none of
// these" that leaves a record behind.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: {
    chair: {
      listClients: 'chair:listClients',
      budgetStatus: 'chair:budgetStatus',
      startVisit: 'chair:startVisit',
      recordConsent: 'chair:recordConsent',
      approveTake: 'chair:approveTake',
      discardTake: 'chair:discardTake',
      scrapTake: 'chair:scrapTake',
      recordDecision: 'chair:recordDecision',
      lastVisitContext: 'chair:lastVisitContext',
      myCard: 'chair:myCard',
      listTakes: 'chair:listTakes',
      finishTake: 'chair:finishTake',
    },
    barberTryOn: {
      generateUploadUrl: 'barberTryOn:generateUploadUrl',
      getUploadedImageUrl: 'barberTryOn:getUploadedImageUrl',
    },
  },
}));

const startVisitMock = vi.fn(async ({ name }: { name: string }) => ({
  clientId: 'client_1',
  name,
  needsConsent: true,
}));
const recordConsentMock = vi.fn(async () => null);
const approveTakeMock = vi.fn(async () => null);
const discardTakeMock = vi.fn(async () => null);
const scrapTakeMock = vi.fn(async () => null);
const recordDecisionMock = vi.fn(async () => null);

const mutations: Record<string, unknown> = {
  'chair:startVisit': startVisitMock,
  'chair:recordConsent': recordConsentMock,
  'chair:approveTake': approveTakeMock,
  'chair:discardTake': discardTakeMock,
  'chair:scrapTake': scrapTakeMock,
  'chair:recordDecision': recordDecisionMock,
};

let clientsResult: unknown = [];
let lastVisitResult: unknown = null;
vi.mock('convex/react', () => ({
  useMutation: (ref: string) => mutations[ref] ?? vi.fn(async () => null),
  useQuery: (ref: string) =>
    ref === 'chair:listClients'
      ? clientsResult
      : ref === 'chair:lastVisitContext'
        ? lastVisitResult
        : ref === 'chair:myCard'
          ? { slug: 'marcus', bookingEnabled: false }
          : { takesLeftToday: 9, dailyCap: 20, globalExhausted: false },
  useConvex: () => ({ query: vi.fn(async () => 'https://storage.test/x') }),
}));

vi.mock('@/hooks/useConvexUpload', () => ({
  useConvexUpload: () => vi.fn(async () => ({ storageId: 'storage_1', url: 'https://storage.test/x' })),
}));

// The live take, stubbed down to "it produced a clip".
const startTakeMock = vi.fn(async () => ({
  takeId: 'take_1',
  recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
}));
const saveRecordingMock = vi.fn(async () => 'storage_video');
const setPromptMock = vi.fn();
const stopTakeMock = vi.fn();
const closeCameraMock = vi.fn();

vi.mock('@/hooks/useChairTake', () => ({
  useChairTake: () => ({
    cameraStream: null,
    outputStream: null,
    status: 'streaming',
    elapsedMs: 0,
    error: '',
    facing: 'user',
    setError: vi.fn(),
    openCamera: vi.fn(async () => null),
    closeCamera: closeCameraMock,
    flipCamera: vi.fn(),
    startTake: startTakeMock,
    stopTake: stopTakeMock,
    cancelTake: vi.fn(),
    setPrompt: setPromptMock,
    saveRecording: saveRecordingMock,
  }),
}));

// Frame decoding needs a real <video> and canvas; the selection logic it feeds
// is tested directly in src/lib/chair/angleSelection.test.ts.
vi.mock('@/lib/chair/frames', () => ({
  preloadLandmarker: vi.fn(),
  measureTake: vi.fn(async () => ({
    samples: [{ tMs: 0, yawDeg: 0, faceFound: true, sharpness: 100 }],
    measured: true,
    durationMs: 30_000,
  })),
  extractFrames: vi.fn(async (_blob: Blob, times: number[]) =>
    times.map(() => new Blob(['frame'], { type: 'image/jpeg' })),
  ),
}));

vi.mock('@/lib/chair/angleSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chair/angleSelection')>();
  return {
    ...actual,
    pickAngleFrames: vi.fn(() => [
      { key: 'front', sampleIndex: 0, tMs: 1000, yawDeg: 0, confidence: 0.9 },
      { key: 'back', sampleIndex: 1, tMs: 15_000, yawDeg: 180, confidence: 0.7 },
    ]),
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let searchParamsResult = new URLSearchParams();
const routerReplaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  useSearchParams: () => searchParamsResult,
}));

import ChairStation from './ChairStation';
// The partial module mock above leaves pickAngleFrames a vi.fn — imported here
// so individual tests can deal a different sheet.
import { pickAngleFrames } from '@/lib/chair/angleSelection';

beforeEach(() => {
  clientsResult = [];
  lastVisitResult = null;
  searchParamsResult = new URLSearchParams();
  vi.clearAllMocks();
  startVisitMock.mockImplementation(async ({ name }: { name: string }) => ({
    clientId: 'client_1',
    name,
    needsConsent: true,
  }));
  // jsdom has neither.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  }
  global.fetch = vi.fn(async () => new Response(new Blob(['frame']))) as never;
});
afterEach(cleanup);

/** Walk from the name form to an armed stage with a consented client. */
async function reachStage() {
  render(<ChairStation />);
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
  await screen.findByRole('button', { name: /let’s do it/i });
  fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
  await screen.findByLabelText(/live try-on/i);
}

describe('the home screen', () => {
  test('opens straight on the name form — no roster screen in front of it', async () => {
    render(<ChairStation />);
    expect(screen.getByText(/who’s in the chair\?/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone \(optional\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next client/i })).not.toBeInTheDocument();
  });

  test('without a card there is no form — the chair says what to set up first', async () => {
    clientsResult = null;
    render(<ChairStation />);
    expect(screen.getByText(/set up your barber card first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
  });

  test('lists returning clients so a regular is one tap, not a retype', async () => {
    clientsResult = [
      { id: 'c1', name: 'Dre', consented: true, createdAt: Date.now(), lastVisitAt: Date.now() },
    ];
    render(<ChairStation />);
    expect(screen.getByText('Dre')).toBeInTheDocument();
  });

  test('a client with consent on file skips straight to the cut picker', async () => {
    clientsResult = [
      { id: 'c1', name: 'Dre', consented: true, createdAt: Date.now(), lastVisitAt: Date.now() },
    ];
    render(<ChairStation />);
    fireEvent.click(screen.getByRole('button', { name: /Dre/ }));
    await screen.findByLabelText(/live try-on/i);
    expect(recordConsentMock).not.toHaveBeenCalled();
  });

  test('a client without consent on file is asked first', async () => {
    clientsResult = [
      { id: 'c1', name: 'Dre', consented: false, createdAt: Date.now(), lastVisitAt: Date.now() },
    ];
    render(<ChairStation />);
    fireEvent.click(screen.getByRole('button', { name: /Dre/ }));
    await screen.findByRole('button', { name: /let’s do it/i });
  });

  test('shows today’s remaining takes, because they run out', async () => {
    render(<ChairStation />);
    expect(screen.getByText(/9 left today/i)).toBeInTheDocument();
  });
});

describe('naming a walk-in', () => {
  test('refuses an empty name instead of filing a take under nothing', async () => {
    render(<ChairStation />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
    expect(startVisitMock).not.toHaveBeenCalled();
  });

  test('opens the visit under the typed name', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '  Marcus  T. ' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await waitFor(() =>
      expect(startVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Marcus T.' }),
      ),
    );
  });
});

describe('consent', () => {
  test('a new walk-in cannot reach the camera without agreeing', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    await screen.findByRole('button', { name: /let’s do it/i });
    expect(screen.queryByLabelText(/live try-on/i)).not.toBeInTheDocument();
    expect(startTakeMock).not.toHaveBeenCalled();
  });

  test('the consent screen says what is filmed, stored, and how to undo it', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    const panel = await screen.findByLabelText(/before we film/i);
    expect(panel).toHaveTextContent(/up to a minute/i);
    expect(panel).toHaveTextContent(/saved to your barber/i);
    expect(panel).toHaveTextContent(/delete/i);
  });

  test('it also shows what the minute is for, and draws the screen', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    const panel = await screen.findByLabelText(/before we film/i);
    expect(panel).toHaveTextContent(/use the prompt box and suggestions below/i);
    // The diagram, in the studio palette, and honest about being a drawing.
    const diagram = panel.querySelector('.ltp');
    expect(diagram).not.toBeNull();
    expect(diagram!.className).toContain('is-dark');
    expect(panel).toHaveTextContent(/not a preview of your result/i);
    // Still no camera on this screen — it is a drawing, not a viewfinder.
    expect(panel.querySelector('video')).toBeNull();
  });

  test('declining backs all the way out rather than proceeding quietly', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    fireEvent.click(await screen.findByRole('button', { name: /no thanks/i }));
    // Back on a blank name form — the declined client's details don't linger.
    await screen.findByText(/who’s in the chair\?/i);
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
    expect(recordConsentMock).not.toHaveBeenCalled();
  });

  test('agreeing records the tap and opens the camera', async () => {
    await reachStage();
    expect(recordConsentMock).toHaveBeenCalledWith({ clientId: 'client_1' });
  });
});

// The money rule: the stage is armed for free and the FIRST ASK is what spends
// a take. A screen between consent and the camera used to absorb these taps;
// now the recording UI is the landing screen, so every one of them is a charge
// and has to be one the barber deliberately made.
describe('starting a take', () => {
  test('landing on the stage costs nothing — no take until someone asks', async () => {
    await reachStage();
    expect(startTakeMock).not.toHaveBeenCalled();
    // And it says so, rather than leaving the barber to guess from a live view.
    expect(screen.getByText(/nothing running yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start the 60s take/i })).toBeDisabled();
  });

  test('the first suggestion tap is the take — no second confirm', async () => {
    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));

    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    expect(startTakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        cutSlug: 'blowout-taper',
        cutLabel: 'blowout taper',
        prompt: expect.stringContaining('Change ONLY the hair'),
      }),
    );
  });

  test('the first prompt is the take too — free text alone is enough', async () => {
    await reachStage();
    fireEvent.change(screen.getByLabelText(/say what you want/i), {
      target: { value: 'buzz it down to a one' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^go$/i }));

    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    expect(startTakeMock.mock.calls[0][0]).toMatchObject({
      prompt: expect.stringContaining('buzz it down to a one'),
    });
  });

  test('typing without submitting spends nothing', async () => {
    await reachStage();
    fireEvent.change(screen.getByLabelText(/say what you want/i), {
      target: { value: 'buzz it' },
    });
    expect(startTakeMock).not.toHaveBeenCalled();
  });

  test('a second chip during a take re-steers it instead of buying another', async () => {
    // A take that never resolves: the stage stays live while we tap again.
    startTakeMock.mockImplementationOnce(() => new Promise(() => {}) as never);
    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /modern mullet/i }));
    await waitFor(() => expect(setPromptMock).toHaveBeenCalled());
    expect(startTakeMock).toHaveBeenCalledTimes(1);
  });

  test('a failed take leaves the barber on the stage with their ask intact', async () => {
    startTakeMock.mockResolvedValueOnce(null as never);
    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));

    await screen.findByLabelText(/live try-on/i);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /blowout taper/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    // Armed again, so the retry is one tap and not a walk back through consent.
    expect(screen.getByRole('button', { name: /start the 60s take/i })).toBeEnabled();
  });
});

describe('review, the reference sheet, and retry', () => {
  async function reachReview() {
    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));
    await screen.findByRole('button', { name: /that’s the one/i });
  }

  /** The sheet deals two shots (front + back, per the mock); pick them both. */
  async function pickBothShots() {
    fireEvent.click(await screen.findByRole('button', { name: /^front$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
  }

  test('the clip is persisted as soon as the take ends, before any decision', async () => {
    await reachReview();
    expect(saveRecordingMock).toHaveBeenCalledWith('take_1', expect.objectContaining({
      durationMs: 30_000,
    }));
  });

  test('the take is analyzed for reference shots the moment review opens', async () => {
    await reachReview();
    // The sheet is dealt without any tap — MediaPipe ran on arrival.
    await screen.findByRole('button', { name: /^front$/i });
    await screen.findByRole('button', { name: /^back$/i });
    expect(screen.getByText(/tap the 2–4 shots/i)).toBeInTheDocument();
  });

  test('"yes" stays locked until the barber has picked enough shots', async () => {
    await reachReview();
    await screen.findByRole('button', { name: /^front$/i });
    expect(screen.getByRole('button', { name: /that’s the one/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^front$/i }));
    expect(screen.getByRole('button', { name: /that’s the one/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('button', { name: /that’s the one/i })).toBeEnabled();
  });

  test('picking a shot marks it, and a second tap lets it go', async () => {
    await reachReview();
    const front = await screen.findByRole('button', { name: /^front$/i });
    expect(front).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(front);
    expect(front).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(front);
    expect(front).toHaveAttribute('aria-pressed', 'false');
  });

  test('a fifth pick is refused — four shots is the ceiling', async () => {
    vi.mocked(pickAngleFrames).mockReturnValueOnce([
      { key: 'leftProfile', sampleIndex: 0, tMs: 1000, yawDeg: -80, confidence: 0.8 },
      { key: 'leftThreeQuarter', sampleIndex: 1, tMs: 2000, yawDeg: -35, confidence: 0.8 },
      { key: 'front', sampleIndex: 2, tMs: 3000, yawDeg: 0, confidence: 0.9 },
      { key: 'rightThreeQuarter', sampleIndex: 3, tMs: 4000, yawDeg: 35, confidence: 0.8 },
      { key: 'rightProfile', sampleIndex: 4, tMs: 5000, yawDeg: 80, confidence: 0.8 },
      { key: 'back', sampleIndex: 5, tMs: 6000, yawDeg: 180, confidence: 0.7 },
    ]);
    await reachReview();

    fireEvent.click(await screen.findByRole('button', { name: 'Left profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Left ¾' }));
    fireEvent.click(screen.getByRole('button', { name: /^front$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Right ¾' }));
    fireEvent.click(screen.getByRole('button', { name: 'Right profile' }));

    // The fifth tap did nothing — four picks stand, the fifth shot stays loose.
    expect(screen.getByRole('button', { name: 'Right profile' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const pressed = screen
      .getAllByRole('button', { pressed: true })
      .filter((b) => b.className.includes('chair-shot'));
    expect(pressed).toHaveLength(4);
  });

  test('"try another" keeps the client and returns to the picker', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /try another/i }));

    await screen.findByLabelText(/live try-on/i);
    // The take is marked discarded, not deleted, and the client is unchanged.
    expect(discardTakeMock).toHaveBeenCalledWith({ takeId: 'take_1' });
    expect(screen.getByText('Marcus T.')).toBeInTheDocument();
  });

  test('"yes" files exactly the shots the barber picked — nothing more', async () => {
    await reachReview();
    await pickBothShots();
    fireEvent.click(screen.getByRole('button', { name: /that’s the one/i }));

    // The saved screen is up while the upload runs behind it.
    await screen.findByText(/filed under Marcus T\./i);
    await waitFor(() => expect(approveTakeMock).toHaveBeenCalled());
    const { takeId, angles } = approveTakeMock.mock.calls[0][0] as {
      takeId: string;
      angles: { key: string }[];
    };
    expect(takeId).toBe('take_1');
    // The angles are the barber's picks off the MediaPipe sheet.
    expect(angles.map((a) => a.key).sort()).toEqual(['back', 'front']);
  });

  test('confirms the save, then frees the chair for the next person', async () => {
    await reachReview();
    await pickBothShots();
    fireEvent.click(screen.getByRole('button', { name: /that’s the one/i }));

    await screen.findByText(/filed under Marcus T\./i);
    fireEvent.click(screen.getByRole('button', { name: /next client/i }));

    await screen.findByText(/who’s in the chair\?/i);
    // The camera is released between clients, not held for the whole shift.
    expect(closeCameraMock).toHaveBeenCalled();
  });

  test('a failed save says so and offers a retry — the picks are not lost', async () => {
    approveTakeMock.mockRejectedValueOnce(new Error('offline'));
    await reachReview();
    await pickBothShots();
    fireEvent.click(screen.getByRole('button', { name: /that’s the one/i }));

    await screen.findByText(/couldn’t save that take/i);
    fireEvent.click(screen.getByRole('button', { name: /try saving again/i }));
    await screen.findByText(/filed under Marcus T\./i);
    expect(approveTakeMock).toHaveBeenCalledTimes(2);
  });
});

describe('"none of these"', () => {
  test('scraps every take from the sitting and leaves the chair on the name form', async () => {
    startTakeMock
      .mockResolvedValueOnce({
        takeId: 'take_1',
        recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
      } as never)
      .mockResolvedValueOnce({
        takeId: 'take_2',
        recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
      } as never);

    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));

    // First take rejected, second take rejected too — they liked nothing.
    fireEvent.click(await screen.findByRole('button', { name: /try another/i }));
    await screen.findByLabelText(/live try-on/i);
    // The re-armed stage still holds the ask, so the retry is the one button.
    fireEvent.click(screen.getByRole('button', { name: /start the 60s take/i }));
    fireEvent.click(await screen.findByRole('button', { name: /none of these/i }));

    await screen.findByText(/who’s in the chair\?/i);
    // Both takes are really deleted — the near-miss included — and nothing
    // was ever approved.
    await waitFor(() => expect(scrapTakeMock).toHaveBeenCalledTimes(2));
    expect(scrapTakeMock).toHaveBeenCalledWith({ takeId: 'take_1' });
    expect(scrapTakeMock).toHaveBeenCalledWith({ takeId: 'take_2' });
    expect(approveTakeMock).not.toHaveBeenCalled();
  });
});

describe('seating from the Today view', () => {
  test('?name= opens the visit directly and carries the booking id', async () => {
    searchParamsResult = new URLSearchParams('name=Dre&phone=555-0134&booking=bk_1');
    startVisitMock.mockResolvedValueOnce({ clientId: 'client_9', name: 'Dre', needsConsent: false });
    render(<ChairStation />);

    await screen.findByLabelText(/live try-on/i);
    expect(startVisitMock).toHaveBeenCalledWith({
      name: 'Dre',
      phone: '555-0134',
      bookingId: 'bk_1',
    });
    // The URL is cleaned so a reload doesn't re-seat them.
    expect(routerReplaceMock).toHaveBeenCalledWith('/chair');
  });

  test('a plain visit sends no booking id', async () => {
    render(<ChairStation />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marcus T.' } });
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(startVisitMock).toHaveBeenCalled());
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});

describe('the last-time card', () => {
  const lastVisit = {
    when: Date.now() - 14 * 24 * 60 * 60 * 1000,
    cutLabel: 'blowout taper',
    cutSlug: 'blowout-taper',
    note: 'went 0.5 lower than usual',
    chips: ['#2', 'Taper'],
    serviceName: undefined,
    posterUrl: 'https://storage.test/poster.jpg',
    angles: [{ key: 'front', url: 'https://storage.test/front.jpg' }],
  };

  test('a returning client’s stage leads with what they got last time', async () => {
    lastVisitResult = lastVisit;
    clientsResult = [
      { id: 'c1', name: 'Dre', consented: true, createdAt: Date.now(), lastVisitAt: Date.now() },
    ];
    render(<ChairStation />);
    fireEvent.click(screen.getByRole('button', { name: /Dre/ }));

    const card = await screen.findByLabelText(/last visit/i);
    expect(card).toHaveTextContent(/blowout taper/i);
    expect(card).toHaveTextContent(/went 0\.5 lower/i);
    expect(card).toHaveTextContent('#2');
  });

  test('"Same again" runs last time’s cut without retyping or re-picking it', async () => {
    lastVisitResult = lastVisit;
    clientsResult = [
      { id: 'c1', name: 'Dre', consented: true, createdAt: Date.now(), lastVisitAt: Date.now() },
    ];
    render(<ChairStation />);
    fireEvent.click(screen.getByRole('button', { name: /Dre/ }));

    fireEvent.click(await screen.findByRole('button', { name: /same again/i }));
    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    expect(startTakeMock.mock.calls[0][0]).toMatchObject({ cutSlug: 'blowout-taper' });
  });

  test('a first-timer gets no card — there is no last time to show', async () => {
    await reachStage();
    expect(screen.queryByLabelText(/last visit/i)).not.toBeInTheDocument();
  });
});

describe('the decision', () => {
  async function reachSaved() {
    await reachStage();
    fireEvent.click(screen.getByRole('button', { name: /blowout taper/i }));
    await screen.findByRole('button', { name: /that’s the one/i });
    // The sheet gates the save: pick the two dealt shots first.
    fireEvent.click(await screen.findByRole('button', { name: /^front$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    fireEvent.click(screen.getByRole('button', { name: /that’s the one/i }));
    await screen.findByText(/filed under Marcus T\./i);
  }

  test('chips and a note file under today’s visit', async () => {
    await reachSaved();
    fireEvent.click(screen.getByRole('button', { name: /^#2$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^taper$/i }));
    fireEvent.change(screen.getByLabelText(/note for next time/i), {
      target: { value: 'left the fringe alone' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() =>
      expect(recordDecisionMock).toHaveBeenCalledWith({
        clientId: 'client_1',
        note: 'left the fringe alone',
        chips: ['#2', 'Taper'],
      }),
    );
    await screen.findByRole('button', { name: /noted/i });
  });

  test('with nothing to say there is nothing to save — next client stays primary', async () => {
    await reachSaved();
    expect(screen.getByRole('button', { name: /save note/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next client/i })).toBeEnabled();
  });
});
