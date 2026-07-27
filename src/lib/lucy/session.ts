// ============================================================
// The live video session: camera → realtime model → transformed stream.
//
// The endpoint is a SIGNALLING RELAY, not a media pipe. fal's websocket carries
// only SDP and ICE; the video itself flows peer-to-peer between this browser
// and the model host. So this module is really a WebRTC negotiator that happens
// to use a websocket for its handshake:
//
//   send prompt ──▶
//              ◀── ready           the relay's hello; nothing to do
//              ◀── iceServers      build RTCPeerConnection, add camera tracks
//   offer      ──▶
//              ◀── answer          setRemoteDescription, flush buffered ICE
//   ⇄ icecandidate                 trickle both ways
//              ◀── generation_started   → 'streaming', frames are arriving
//
// Two details that are easy to get wrong and expensive to debug:
//
//  * ICE candidates routinely arrive BEFORE the answer. Calling
//    addIceCandidate with no remote description throws, so early candidates are
//    buffered and flushed once the answer lands.
//  * Re-steering ("try a taper instead") is a `prompt` send on the EXISTING
//    connection. Tearing down the peer connection to change the cut would cost
//    a fresh handshake and a visible freeze in front of the client — and this
//    model bills by the second, so the reconnect would be billed too.
//
// Deliberately React-free, with `connect` and `createPeerConnection` injectable,
// so the state machine can be tested without a browser or a live key. See
// session.test.ts.
// ============================================================

import { fal } from '@fal-ai/client';
import { LUCY_REALTIME_APP } from './constants';

export type LucyStatus =
  | 'connecting'   // websocket opening, prompt sent
  | 'negotiating'  // ICE servers in hand, offer/answer in flight
  | 'streaming'    // frames arriving
  | 'closed'
  | 'error';

/** Anything the relay can send back. Unknown `type`s are ignored, not fatal. */
interface LucyMessage {
  type?: string;
  sdp?: string;
  iceServers?: RTCIceServer[];
  ice_servers?: RTCIceServer[];
  candidate?: RTCIceCandidateInit;
  error?: unknown;
  message?: string;
}

/**
 * The slice of the realtime client this module actually uses. Declared locally
 * rather than imported from the package's internals: `RealtimeConnection` isn't
 * on its public export surface, and a structural type is also what makes the
 * `connect` seam mockable in tests.
 */
interface LucyConnection {
  send(payload: Record<string, unknown>): void;
  close(): void;
}

type ConnectFn = (
  app: string,
  handler: {
    connectionKey?: string;
    throttleInterval?: number;
    onResult: (result: LucyMessage) => void;
    onError?: (error: unknown) => void;
    tokenProvider?: (app: string) => Promise<string>;
    tokenExpirationSeconds?: number;
  },
) => LucyConnection;

export interface LucySessionOptions {
  /** The barber's camera. Its tracks are what the model transforms. */
  inputStream: MediaStream;
  /** The composed haircut instruction — see barberPrompt.ts. */
  prompt: string;
  /** Fetches a short-lived token from /api/fal/realtime-token. */
  tokenProvider: (app: string) => Promise<string>;
  /**
   * Leave this UNSET for chair takes.
   *
   * Supplying it turns on the client's automatic token refresh, and our token
   * route doesn't just mint — it also CLAIMS BUDGET for a take
   * (convex/chair.ts `startTake`). A refresh would silently open a second take
   * and bill the barber for it. A take is capped at 30 seconds against a
   * 120-second token, so a refresh can never legitimately be needed anyway.
   */
  tokenExpirationSeconds?: number;
  /** Let the model rewrite the instruction before applying it. */
  enablePromptExpansion?: boolean;
  onStatus?: (status: LucyStatus) => void;
  /** The transformed video. Fires once, as soon as the remote track lands. */
  onOutputStream?: (stream: MediaStream) => void;
  /** Source-language (EN) message. Render through t(). */
  onError?: (message: string) => void;
  // ── seams for testing ──
  connect?: ConnectFn;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface LucySession {
  /** Re-steer the live feed without renegotiating. */
  setPrompt(prompt: string): void;
  close(): void;
  readonly status: LucyStatus;
}

/**
 * A public STUN server is the fallback when the relay hasn't told us its own.
 * Without at least one, a peer connection behind NAT never gathers a usable
 * candidate and the take silently never starts.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function errorMessage(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (raw && typeof raw === 'object') {
    const m = (raw as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return 'The live connection dropped. Start the take again.';
}

export function createLucySession(options: LucySessionOptions): LucySession {
  const {
    inputStream,
    prompt,
    tokenProvider,
    tokenExpirationSeconds,
    enablePromptExpansion = false,
    onStatus,
    onOutputStream,
    onError,
    connect = fal.realtime.connect as unknown as ConnectFn,
    createPeerConnection = (config) => new RTCPeerConnection(config),
  } = options;

  let status: LucyStatus = 'connecting';
  let pc: RTCPeerConnection | null = null;
  let closed = false;
  let outputDelivered = false;
  /** Candidates that arrived before the answer — see the header note. */
  const pendingCandidates: RTCIceCandidateInit[] = [];

  const setStatus = (next: LucyStatus) => {
    if (closed && next !== 'closed') return;
    if (status === next) return;
    status = next;
    onStatus?.(next);
  };

  const fail = (raw: unknown) => {
    if (closed) return;
    setStatus('error');
    onError?.(errorMessage(raw));
  };

  const connection = connect(LUCY_REALTIME_APP, {
    // Unique per take: a reused key would hand this take the previous take's
    // socket, and with it the previous cut's prompt state.
    connectionKey: `chair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // The default throttle batches sends. Signalling messages must not be
    // coalesced or dropped — an eaten offer hangs the handshake forever.
    throttleInterval: 0,
    tokenProvider,
    tokenExpirationSeconds,
    onError: fail,
    onResult: (message) => {
      if (closed) return;
      void handleMessage(message);
    },
  });

  const send = (payload: Record<string, unknown>) => {
    try {
      connection.send(payload);
    } catch (err) {
      fail(err);
    }
  };

  async function startNegotiation(iceServers: RTCIceServer[], iceRestart = false) {
    try {
      if (!pc) {
        pc = createPeerConnection({ iceServers });

        for (const track of inputStream.getTracks()) {
          pc.addTrack(track, inputStream);
        }

        pc.ontrack = (event) => {
          const stream = event.streams[0];
          if (!stream || outputDelivered) return;
          outputDelivered = true;
          onOutputStream?.(stream);
        };

        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          send({ type: 'icecandidate', candidate: event.candidate.toJSON() });
        };

        pc.onconnectionstatechange = () => {
          if (closed || !pc) return;
          if (pc.connectionState === 'failed') {
            fail('The video connection failed. Check the camera and try again.');
          }
        };
      }

      setStatus('negotiating');
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      send({ type: 'offer', sdp: offer.sdp });
    } catch (err) {
      fail(err);
    }
  }

  async function handleMessage(message: LucyMessage) {
    // The relay's casing is not stable API: the live endpoint sends camelCase
    // (`iceServers`, per its own OpenAPI schema). Matching case-insensitively
    // means a casing change on Decart's side can't silently strand the
    // handshake in `connecting` again.
    switch (message.type?.toLowerCase()) {
      case 'ready':
        // The relay's hello after the socket opens. Nothing to do — the prompt
        // was already sent — but it's named here so it can't be mistaken for an
        // unknown message.
        break;

      case 'iceservers':
        await startNegotiation(message.iceServers ?? message.ice_servers ?? FALLBACK_ICE_SERVERS);
        break;

      case 'ice-restart':
        await startNegotiation(
          message.iceServers ?? message.ice_servers ?? FALLBACK_ICE_SERVERS,
          true,
        );
        break;

      case 'answer': {
        if (!pc || !message.sdp) return;
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
          for (const candidate of pendingCandidates.splice(0)) {
            await pc.addIceCandidate(candidate).catch(() => {
              // A single unusable candidate is normal; ICE has others.
            });
          }
        } catch (err) {
          fail(err);
        }
        break;
      }

      case 'icecandidate': {
        if (!message.candidate) return;
        if (!pc || !pc.remoteDescription) {
          pendingCandidates.push(message.candidate);
          return;
        }
        await pc.addIceCandidate(message.candidate).catch(() => {});
        break;
      }

      case 'generation_started':
        setStatus('streaming');
        break;

      case 'error':
        fail(message.error ?? message.message);
        break;

      default:
        // prompt_ack / set_image_ack / anything the relay adds later. The take
        // must not break because we don't recognise a new acknowledgement.
        break;
    }
  }

  // Declare the edit first: the relay wants to know what it's generating before
  // the media path is negotiated.
  send({ prompt, enable_prompt_expansion: enablePromptExpansion });

  return {
    setPrompt(next: string) {
      if (closed || !next.trim()) return;
      send({ prompt: next, enable_prompt_expansion: enablePromptExpansion });
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        pc?.close();
      } catch {
        /* already torn down */
      }
      pc = null;
      try {
        connection.close();
      } catch {
        /* already closed */
      }
      status = 'closed';
      onStatus?.('closed');
    },
    get status() {
      return status;
    },
  };
}
