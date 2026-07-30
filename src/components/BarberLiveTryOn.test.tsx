// @vitest-environment jsdom

// The live mirror's phase machine, walked the way a client in a barber's chair
// walks it: consent → ready → live → review → sent.
//
// The camera, the realtime model and the frame decoder are stubbed — they're
// the parts that genuinely need a browser. What's left is the decision logic,
// and the decisions are what hurt when they're wrong: a take that starts
// before consent, a prompt typed mid-take that silently restarts the
// connection (and bills twice), a "send" that files nothing.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HAIRSTYLES } from '@/data/hairstyles';

vi.mock('@convex/_generated/api', () => ({
  api: {
    chair: {
      cardSession: 'chair:cardSession',
      joinCard: 'chair:joinCard',
      shareTake: 'chair:shareTake',
      discardTake: 'chair:discardTake',
      finishTake: 'chair:finishTake',
    },
    barberTryOn: { sendToBarber: 'barberTryOn:sendToBarber' },
    users: { getOrCreate: 'users:getOrCreate' },
    barberPages: { recordEvent: 'barberPages:recordEvent' },
  },
}));

const joinCardMock = vi.fn(async ({ name }: { name: string }) => ({
  clientId: 'client_1',
  name,
}));
const shareTakeMock = vi.fn(async () => ({
  videoUrl: 'https://storage.test/take.webm',
  posterUrl: 'https://storage.test/poster.jpg',
}));
const discardTakeMock = vi.fn(async () => null);
const recordEventMock = vi.fn(async () => null);
const sendToBarberMock = vi.fn(async () => ({ ok: true, emailed: true }));

const mutations: Record<string, unknown> = {
  'chair:joinCard': joinCardMock,
  'chair:shareTake': shareTakeMock,
  'chair:discardTake': discardTakeMock,
  'barberPages:recordEvent': recordEventMock,
};

let sessionResult: unknown = { clientId: null, name: null, needsConsent: true, takesLeftToday: 9 };
let signedIn = true;

vi.mock('convex/react', () => ({
  useMutation: (ref: string) => mutations[ref] ?? vi.fn(async () => null),
  useAction: () => sendToBarberMock,
  useQuery: () => sessionResult,
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    isSignedIn: signedIn,
    user: signedIn
      ? { firstName: 'Dre', fullName: 'Dre Watts', primaryEmailAddress: { emailAddress: 'dre@example.com' } }
      : null,
  }),
}));

vi.mock('@/components/SignUpWidget', () => ({
  default: () => <div data-testid="signup-widget" />,
}));

vi.mock('@/hooks/useConvexUpload', () => ({
  useConvexUpload: () => vi.fn(async () => ({ storageId: 'storage_1', url: 'https://storage.test/x' })),
}));

const startTakeMock = vi.fn(async () => ({
  takeId: 'take_1',
  recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
}));
const setPromptMock = vi.fn();
const stopTakeMock = vi.fn();
const saveRecordingMock = vi.fn(async () => 'storage_video');

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
    closeCamera: vi.fn(),
    flipCamera: vi.fn(),
    startTake: startTakeMock,
    stopTake: stopTakeMock,
    cancelTake: vi.fn(),
    setPrompt: setPromptMock,
    saveRecording: saveRecordingMock,
  }),
}));

vi.mock('@/lib/chair/frames', () => ({
  extractFrames: vi.fn(async (_blob: Blob, times: number[]) =>
    times.map(() => new Blob(['frame'], { type: 'image/jpeg' })),
  ),
}));

import BarberLiveTryOn from './BarberLiveTryOn';

const CUT = HAIRSTYLES[0];
const PICKS = HAIRSTYLES.slice(0, 3);

function renderPanel(props: Partial<React.ComponentProps<typeof BarberLiveTryOn>> = {}) {
  return render(
    <BarberLiveTryOn
      barberSlug="marcus"
      barberName="Marcus"
      cut={CUT}
      barberPicks={PICKS}
      menuCuts={HAIRSTYLES}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = true;
  sessionResult = { clientId: null, name: null, needsConsent: true, takesLeftToday: 9 };
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  }
});
afterEach(cleanup);

/** Consent, then start and finish one take — the common path. */
async function reachReview() {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
  await screen.findByRole('button', { name: /start the 180s take/i });
  fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));
  await screen.findByRole('button', { name: /send to marcus/i });
}

describe('nothing films before it is allowed to', () => {
  test('a signed-out visitor gets sign-in, not a camera', () => {
    signedIn = false;
    const { container } = renderPanel();
    expect(screen.getByTestId('signup-widget')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: /start the 180s take/i })).toBeNull();
  });

  test('consent comes first, and it says what is filmed and where it goes', () => {
    renderPanel();
    expect(screen.getByText(/before the camera starts/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 3 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/saved to Marcus’s ShapeUp account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start the 180s take/i })).toBeNull();
    expect(startTakeMock).not.toHaveBeenCalled();
  });

  test('a returning visitor who already agreed is not asked twice', async () => {
    sessionResult = { clientId: 'client_1', name: 'Dre', needsConsent: false, takesLeftToday: 9 };
    renderPanel();
    await screen.findByRole('button', { name: /start the 180s take/i });
    expect(screen.queryByText(/before the camera starts/i)).toBeNull();
  });

  test('the consent tap files the client under the barber', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await waitFor(() =>
      expect(joinCardMock).toHaveBeenCalledWith({ slug: 'marcus', name: 'Dre' }),
    );
  });
});

describe('the screen before the take explains the take', () => {
  // Consent renders once per client, so it is the wrong home for anything a
  // client needs every time. This lives on `ready`, which everyone crosses.
  test('the ready screen says what the minute is for, and draws the screen', async () => {
    sessionResult = { clientId: 'client_1', name: 'Dre', needsConsent: false, takesLeftToday: 9 };
    const { container } = renderPanel();
    await screen.findByRole('button', { name: /start the 180s take/i });

    expect(screen.getByText(/use the prompt box and suggestions below/i)).toBeInTheDocument();
    expect(container.querySelector('.ltp')).not.toBeNull();
    // The diagram says it is a diagram.
    expect(screen.getByText(/not a preview of your result/i)).toBeInTheDocument();
  });
});

describe('there is no photo step anywhere in the flow', () => {
  test('the panel never asks for a selfie, an upload, or a shutter', async () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });

    expect(container.textContent).not.toMatch(/selfie|take a photo|upload/i);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    // What it offers instead is a live camera.
    expect(container.querySelector('video')).not.toBeNull();
  });
});

describe('the take', () => {
  test('claims against the card, not a walk-in id', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));

    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    const args = startTakeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args).toMatchObject({ slug: 'marcus', cutSlug: CUT.slug });
    expect(args).not.toHaveProperty('clientId');
    expect(String(args.prompt)).toContain('Change ONLY the hair');
  });

  test('refuses to start when the barber has no takes left today', async () => {
    sessionResult = { clientId: 'client_1', name: 'Dre', needsConsent: false, takesLeftToday: 0 };
    renderPanel();
    const button = await screen.findByRole('button', { name: /busy day/i });
    expect(button).toBeDisabled();
    expect(startTakeMock).not.toHaveBeenCalled();
  });

  test('the clip is saved and the finished take is counted once', async () => {
    await reachReview();
    expect(saveRecordingMock).toHaveBeenCalledWith('take_1', expect.anything());
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'preview' });
  });

  test('starting the take is the try-on — it records the funnel event itself', async () => {
    await reachReview();
    expect(recordEventMock).toHaveBeenCalledWith({
      slug: 'marcus',
      kind: 'tryOn',
      cutSlug: CUT.slug,
    });
  });
});

describe('the cut lives inside the flow, not on a screen in front of it', () => {
  test('the ready screen offers cut chips, and a tapped one is what the take runs', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });

    const chips = screen.getByRole('list', { name: /pick a cut/i });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(PICKS[2].label, 'i') }));
    expect(chips).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));

    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    const args = startTakeMock.mock.calls[0][0] as { cutSlug: string };
    expect(args.cutSlug).toBe(PICKS[2].slug);
  });

  test('without onClose the panel is the whole page — no back affordance until live', async () => {
    renderPanel({ onClose: undefined });
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    expect(screen.queryByRole('button', { name: /^back$/i })).toBeNull();

    let endTake: (r: unknown) => void = () => {};
    startTakeMock.mockImplementationOnce(
      () => new Promise((resolve) => { endTake = resolve; }) as never,
    );
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
    endTake({
      takeId: 'take_1',
      recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
    });
    await screen.findByRole('button', { name: /send to marcus/i });
  });
});

describe('live prompting', () => {
  test('typing mid-take re-steers the running connection instead of restarting it', async () => {
    // Hold the take open so the live phase is genuinely on screen — the whole
    // point of this test is what happens WHILE the model is streaming.
    let endTake: (r: unknown) => void = () => {};
    startTakeMock.mockImplementationOnce(
      () => new Promise((resolve) => { endTake = resolve; }) as never,
    );

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));

    const live = await screen.findByLabelText(/change the cut while it’s running/i);
    fireEvent.change(live, { target: { value: 'shorter on top' } });
    fireEvent.click(screen.getByRole('button', { name: /^go$/i }));

    expect(setPromptMock).toHaveBeenCalledTimes(1);
    expect(String(setPromptMock.mock.calls[0][0])).toContain('shorter on top');
    expect(startTakeMock).toHaveBeenCalledTimes(1); // no second take, no second charge

    endTake({
      takeId: 'take_1',
      recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
    });
    await screen.findByRole('button', { name: /send to marcus/i });
  });

  test('tapping a cut chip mid-take steers it without opening a second take', async () => {
    let endTake: (r: unknown) => void = () => {};
    startTakeMock.mockImplementationOnce(
      () => new Promise((resolve) => { endTake = resolve; }) as never,
    );

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));
    await screen.findByLabelText(/switch the cut live/i);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(PICKS[1].label, 'i') }));
    expect(setPromptMock).toHaveBeenCalledTimes(1);
    expect(String(setPromptMock.mock.calls[0][0])).toContain(PICKS[1].label);
    expect(startTakeMock).toHaveBeenCalledTimes(1);

    endTake({
      takeId: 'take_1',
      recording: { blob: new Blob(['video']), mimeType: 'video/webm', durationMs: 30_000 },
    });
    await screen.findByRole('button', { name: /send to marcus/i });
  });

  test('the pre-flight tweak reaches the model as the client’s words, not the barber’s', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    fireEvent.change(screen.getByLabelText(/anything you want different/i), {
      target: { value: 'keep the fringe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));

    await waitFor(() => expect(startTakeMock).toHaveBeenCalled());
    const { prompt } = startTakeMock.mock.calls[0][0] as { prompt: string };
    expect(prompt).toContain("The client's request");
    expect(prompt).toContain('keep the fringe');
  });
});

describe('review and send', () => {
  test('sends the take to the barber with the client’s own words attached', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /send to marcus/i }));

    await waitFor(() => expect(shareTakeMock).toHaveBeenCalled());
    expect(shareTakeMock.mock.calls[0][0]).toMatchObject({
      takeId: 'take_1',
      posterStorageId: 'storage_1',
    });
    await waitFor(() => expect(sendToBarberMock).toHaveBeenCalled());
    expect(sendToBarberMock.mock.calls[0][0]).toMatchObject({
      slug: 'marcus',
      imageUrl: 'https://storage.test/poster.jpg',
      videoUrl: 'https://storage.test/take.webm',
      clientEmail: 'dre@example.com',
    });
    expect(await screen.findByText(/sent!/i)).toBeInTheDocument();
  });

  test('a failed send does not lose the take — it tells them to show it in the chair', async () => {
    shareTakeMock.mockRejectedValueOnce(new Error('offline'));
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /send to marcus/i }));
    expect(await screen.findByText(/show them this clip in the chair/i)).toBeInTheDocument();
  });

  test('"try another" discards the take and returns to the camera, not the lookbook', async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /let’s do it/i }));
    await screen.findByRole('button', { name: /start the 180s take/i });
    fireEvent.click(screen.getByRole('button', { name: /start the 180s take/i }));
    await screen.findByRole('button', { name: /^try another$/i });

    fireEvent.click(screen.getByRole('button', { name: /^try another$/i }));
    expect(discardTakeMock).toHaveBeenCalledWith({ takeId: 'take_1' });
    expect(await screen.findByRole('button', { name: /start the 180s take/i })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
