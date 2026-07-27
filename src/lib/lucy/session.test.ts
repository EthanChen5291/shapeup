// @vitest-environment jsdom

// The WebRTC handshake, exercised without a browser or a live key.
//
// This is the part of chair mode that can't be verified by reading it: the
// relay's message order isn't guaranteed, and getting it wrong produces a
// session that hangs with no error rather than one that fails loudly. So the
// awkward orderings are pinned here — candidates before the answer, an offer
// before ICE servers, a close mid-handshake.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createLucySession } from './session';
import { LUCY_REALTIME_APP } from './constants';

type Message = Record<string, unknown>;

/** Captures what we sent and lets a test push relay messages back. */
function mockConnect() {
  const sent: Message[] = [];
  let emit: (m: Message) => void = () => {};
  const close = vi.fn();
  const connect = vi.fn((app: string, handler: { onResult: (m: Message) => void }) => {
    emit = handler.onResult;
    return { send: (payload: Message) => sent.push(payload), close };
  });
  return {
    connect: connect as never,
    sent,
    close,
    emit: (m: Message) => emit(m),
    appOf: () => connect.mock.calls[0][0],
    handlerOf: () => connect.mock.calls[0][1] as Record<string, unknown>,
  };
}

class FakePeerConnection {
  static last: FakePeerConnection | null = null;
  config: RTCConfiguration;
  tracks: MediaStreamTrack[] = [];
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  addedCandidates: RTCIceCandidateInit[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  closed = false;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  lastOfferOptions: RTCOfferOptions | undefined;

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.last = this;
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }
  async createOffer(options?: RTCOfferOptions) {
    this.lastOfferOptions = options;
    return { type: 'offer' as const, sdp: 'OFFER_SDP' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    if (!this.remoteDescription) throw new Error('no remote description');
    this.addedCandidates.push(c);
  }
  close() {
    this.closed = true;
  }
}

const CAMERA = { getTracks: () => [{ kind: 'video' } as MediaStreamTrack] } as MediaStream;

function build(overrides: Record<string, unknown> = {}) {
  const relay = mockConnect();
  const onStatus = vi.fn();
  const onOutputStream = vi.fn();
  const onError = vi.fn();
  const session = createLucySession({
    inputStream: CAMERA,
    prompt: 'give this person a low taper',
    tokenProvider: async () => 'TOKEN',
    onStatus,
    onOutputStream,
    onError,
    connect: relay.connect,
    createPeerConnection: (config) => new FakePeerConnection(config) as unknown as RTCPeerConnection,
    ...overrides,
  });
  return { relay, session, onStatus, onOutputStream, onError };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakePeerConnection.last = null;
});

describe('connection', () => {
  test('connects to the pinned endpoint id', () => {
    const { relay } = build();
    expect(relay.appOf()).toBe(LUCY_REALTIME_APP);
  });

  test('declares the edit before any media is negotiated', () => {
    const { relay } = build();
    expect(relay.sent[0]).toEqual({
      prompt: 'give this person a low taper',
      enable_prompt_expansion: false,
    });
  });

  test('disables send throttling — a coalesced offer would hang the handshake', () => {
    const { relay } = build();
    expect(relay.handlerOf().throttleInterval).toBe(0);
  });

  test('leaves token auto-refresh off, so the budget is never claimed twice', () => {
    const { relay } = build();
    expect(relay.handlerOf().tokenExpirationSeconds).toBeUndefined();
  });

  test('uses a fresh connection key per take, never a reused socket', () => {
    const a = build().relay.handlerOf().connectionKey as string;
    const b = build().relay.handlerOf().connectionKey as string;
    expect(a).not.toBe(b);
  });
});

describe('negotiation', () => {
  test('ICE servers trigger an offer carrying the camera track', async () => {
    const { relay, onStatus } = build();
    relay.emit({ type: 'iceservers', iceServers: [{ urls: 'stun:example' }] });
    await flush();

    const pc = FakePeerConnection.last!;
    expect(pc.config.iceServers).toEqual([{ urls: 'stun:example' }]);
    expect(pc.tracks).toHaveLength(1);
    expect(pc.localDescription).toEqual({ type: 'offer', sdp: 'OFFER_SDP' });
    expect(relay.sent).toContainEqual({ type: 'offer', sdp: 'OFFER_SDP' });
    expect(onStatus).toHaveBeenCalledWith('negotiating');
  });

  test('falls back to a public STUN server when the relay sends none', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers' });
    await flush();
    expect(FakePeerConnection.last!.config.iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  test('the answer is applied as the remote description', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    relay.emit({ type: 'answer', sdp: 'ANSWER_SDP' });
    await flush();
    expect(FakePeerConnection.last!.remoteDescription).toEqual({
      type: 'answer',
      sdp: 'ANSWER_SDP',
    });
  });

  test('candidates arriving BEFORE the answer are buffered, then flushed', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();

    // Early candidates: addIceCandidate would throw without a remote description.
    relay.emit({ type: 'icecandidate', candidate: { candidate: 'early-1' } });
    relay.emit({ type: 'icecandidate', candidate: { candidate: 'early-2' } });
    await flush();
    expect(FakePeerConnection.last!.addedCandidates).toEqual([]);

    relay.emit({ type: 'answer', sdp: 'ANSWER_SDP' });
    await flush();
    expect(FakePeerConnection.last!.addedCandidates).toEqual([
      { candidate: 'early-1' },
      { candidate: 'early-2' },
    ]);
  });

  test('candidates after the answer are applied straight away', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    relay.emit({ type: 'answer', sdp: 'ANSWER_SDP' });
    await flush();
    relay.emit({ type: 'icecandidate', candidate: { candidate: 'late' } });
    await flush();
    expect(FakePeerConnection.last!.addedCandidates).toEqual([{ candidate: 'late' }]);
  });

  test('locally gathered candidates are trickled back to the relay', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();

    FakePeerConnection.last!.onicecandidate!({
      candidate: { toJSON: () => ({ candidate: 'mine' }) },
    });
    expect(relay.sent).toContainEqual({ type: 'icecandidate', candidate: { candidate: 'mine' } });
  });

  test('a null candidate (end-of-gathering) is not forwarded', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    const before = relay.sent.length;
    FakePeerConnection.last!.onicecandidate!({ candidate: null });
    expect(relay.sent).toHaveLength(before);
  });

  test('an ice-restart renegotiates on the existing connection', async () => {
    const { relay } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    const pc = FakePeerConnection.last;

    relay.emit({ type: 'ice-restart', iceServers: [{ urls: 'turn:example' }] });
    await flush();

    expect(FakePeerConnection.last).toBe(pc); // not torn down and rebuilt
    expect(pc!.lastOfferOptions).toEqual({ iceRestart: true });
  });
});

describe('output', () => {
  test('the remote track is handed up exactly once', async () => {
    const { relay, onOutputStream } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();

    const stream = {} as MediaStream;
    FakePeerConnection.last!.ontrack!({ streams: [stream] });
    FakePeerConnection.last!.ontrack!({ streams: [stream] });

    expect(onOutputStream).toHaveBeenCalledTimes(1);
    expect(onOutputStream).toHaveBeenCalledWith(stream);
  });

  test('generation_started marks the session as streaming', async () => {
    const { relay, onStatus, session } = build();
    relay.emit({ type: 'generation_started' });
    await flush();
    expect(onStatus).toHaveBeenCalledWith('streaming');
    expect(session.status).toBe('streaming');
  });
});

describe('re-steering', () => {
  test('a new cut is a prompt send, not a renegotiation', async () => {
    const { relay, session } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    const pc = FakePeerConnection.last;

    session.setPrompt('give this person a skin fade');

    expect(relay.sent).toContainEqual({
      prompt: 'give this person a skin fade',
      enable_prompt_expansion: false,
    });
    expect(FakePeerConnection.last).toBe(pc);
    expect(pc!.closed).toBe(false);
  });

  test('an empty re-steer is ignored rather than blanking the instruction', () => {
    const { relay, session } = build();
    const before = relay.sent.length;
    session.setPrompt('   ');
    expect(relay.sent).toHaveLength(before);
  });
});

describe('errors and teardown', () => {
  test('a relay error surfaces a message and stops the session', async () => {
    const { relay, onError, session } = build();
    relay.emit({ type: 'error', error: 'model unavailable' });
    await flush();
    expect(onError).toHaveBeenCalledWith('model unavailable');
    expect(session.status).toBe('error');
  });

  test('an error with no message still says something useful', async () => {
    const { relay, onError } = build();
    relay.emit({ type: 'error' });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/connection/i));
  });

  test('a failed peer connection is reported rather than hanging silently', async () => {
    const { relay, onError } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();
    FakePeerConnection.last!.connectionState = 'failed';
    FakePeerConnection.last!.onconnectionstatechange!();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/camera|failed/i));
  });

  test('unknown message types are ignored, not fatal', async () => {
    const { relay, onError, session } = build();
    relay.emit({ type: 'prompt_ack', ok: true });
    relay.emit({ type: 'set_image_ack' });
    relay.emit({ type: 'something_added_next_year' });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(session.status).not.toBe('error');
  });

  test('close tears down both the peer connection and the socket', async () => {
    const { relay, session, onStatus } = build();
    relay.emit({ type: 'iceservers', iceServers: [] });
    await flush();

    session.close();

    expect(FakePeerConnection.last!.closed).toBe(true);
    expect(relay.close).toHaveBeenCalled();
    expect(session.status).toBe('closed');
    expect(onStatus).toHaveBeenCalledWith('closed');
  });

  test('messages after close are ignored — a late answer must not resurrect it', async () => {
    const { relay, session, onStatus } = build();
    session.close();
    onStatus.mockClear();
    relay.emit({ type: 'iceservers', iceServers: [] });
    relay.emit({ type: 'generation_started' });
    await flush();
    expect(session.status).toBe('closed');
    expect(onStatus).not.toHaveBeenCalled();
  });

  test('closing twice is harmless', () => {
    const { session, relay } = build();
    session.close();
    session.close();
    expect(relay.close).toHaveBeenCalledTimes(1);
  });
});
