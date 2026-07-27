'use client';

// ============================================================
// The lifecycle of one live take, kept out of the UI.
//
// Shared by both surfaces that run the live model — the barber's chair station
// and the live mirror on a public barber card — because a take is the same
// three resources and the same teardown regardless of whose hand is holding
// the phone. Only `startTake`'s arguments differ; see StartTakeArgs.
//
// A take braids three independent resources that all have to be torn down
// together — a camera stream, a WebRTC session, and a MediaRecorder — and every
// one of them keeps costing something if it's leaked: the camera light stays
// on, and the model keeps billing by the second. Putting that in a component
// means every early return and every unmount is a chance to leak one.
//
// Ordering that matters:
//
//  * Recording starts when the FIRST TRANSFORMED FRAME ARRIVES, not when the
//    session opens. Starting at connect would bank several seconds of black
//    video against the take ceiling and start the coach script before the
//    client can see themselves.
//  * The camera is opened once and reused across takes. Re-acquiring it per
//    take costs a visible half-second of black and, on iPads, sometimes a
//    second permission prompt.
//  * `finishTake` fires even when the upload fails, so the barber's budget is
//    reconciled regardless of whether the clip survived.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useConvexUpload } from '@/hooks/useConvexUpload';
import { createLucySession, type LucySession, type LucyStatus } from '@/lib/lucy/session';
import { startTakeRecording, type TakeRecorder, type TakeRecording } from '@/lib/lucy/recorder';
import { MAX_TAKE_SECONDS } from '@/lib/chair/angles';

export type CameraFacing = 'user' | 'environment';

/**
 * Which door the take comes through — the barber's station (`clientId`, a
 * walk-in they already opened) or a client's own phone on a public card
 * (`slug`). /api/fal/realtime-token routes on exactly this shape; everything
 * downstream of the token is identical, which is why one hook serves both.
 */
export type StartTakeArgs = {
  cutLabel: string;
  cutSlug?: string;
  prompt: string;
} & ({ clientId: Id<'chairClients'>; slug?: never } | { slug: string; clientId?: never });

export interface FinishedTake {
  takeId: Id<'chairTakes'>;
  recording: TakeRecording;
}

export interface TokenResponse {
  ok: boolean;
  token?: string;
  takeId?: Id<'chairTakes'>;
  maxSeconds?: number;
  takesLeftToday?: number;
  reason?: 'daily_cap' | 'global_budget';
  /** Machine-readable refusal — 'rate_limited' comes with retryAfterSeconds. */
  code?: string;
  retryAfterSeconds?: number;
  error?: string;
}

/**
 * Why a take was refused, as copy fit for the screen. Source-language (EN)
 * strings — the components render them through t(). Exported for its test.
 */
export function refusalMessage(status: number, payload: TokenResponse): string {
  if (payload.reason === 'daily_cap') {
    return 'That’s every live take for today. They reset tomorrow morning.';
  }
  if (payload.reason === 'global_budget') {
    return 'Live takes are paused for this month.';
  }
  // The pace limiter (2 takes per 2 minutes). A static line rather than a
  // countdown: the wait is at most a minute or two, and a fixed string stays
  // translatable through t().
  if (payload.code === 'rate_limited' || status === 429) {
    return 'Two takes back-to-back — give the mirror a minute, then go again.';
  }
  if (status === 401) {
    return 'Your session timed out. Sign in again to keep going.';
  }
  return payload.error || 'Couldn’t start that take.';
}

export function useChairTake() {
  const upload = useConvexUpload();
  const finishTakeMutation = useMutation(api.chair.finishTake);

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<LucyStatus | 'idle'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<CameraFacing>('user');

  const sessionRef = useRef<LucySession | null>(null);
  const recorderRef = useRef<TakeRecorder | null>(null);
  const takeIdRef = useRef<Id<'chairTakes'> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);

  const stopTicking = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** Drop the session + recorder but keep the camera warm for the next take. */
  const teardownTake = useCallback(() => {
    stopTicking();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setOutputStream(null);
  }, [stopTicking]);

  /** Open (or re-open) the camera. Safe to call repeatedly. */
  const openCamera = useCallback(
    async (nextFacing: CameraFacing = facing): Promise<MediaStream | null> => {
      if (cameraRef.current && nextFacing === facing) return cameraRef.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: nextFacing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          // No microphone: a barbershop conversation is not ours to record, and
          // the model only transforms video.
          audio: false,
        });
        cameraRef.current?.getTracks().forEach((t) => t.stop());
        cameraRef.current = stream;
        setCameraStream(stream);
        setFacing(nextFacing);
        setError('');
        return stream;
      } catch {
        setError('Couldn’t open the camera. Check the browser’s camera permission.');
        return null;
      }
    },
    [facing],
  );

  const flipCamera = useCallback(async () => {
    await openCamera(facing === 'user' ? 'environment' : 'user');
  }, [facing, openCamera]);

  const closeCamera = useCallback(() => {
    cameraRef.current?.getTracks().forEach((t) => t.stop());
    cameraRef.current = null;
    setCameraStream(null);
  }, []);

  /**
   * Run one take end to end. Resolves with the recording once the ceiling (or
   * `stopTake`) ends it, or null when the take never got off the ground.
   */
  const startTake = useCallback(
    async (args: StartTakeArgs): Promise<FinishedTake | null> => {
      setError('');
      setElapsedMs(0);
      teardownTake();

      const camera = await openCamera();
      if (!camera) return null;

      setStatus('connecting');

      let payload: TokenResponse;
      let resStatus: number;
      try {
        const res = await fetch('/api/fal/realtime-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        resStatus = res.status;
        payload = (await res.json()) as TokenResponse;
      } catch {
        setStatus('error');
        setError('Couldn’t reach the live model. Check the shop’s wifi.');
        return null;
      }

      if (!payload.ok || !payload.token || !payload.takeId) {
        setStatus('error');
        setError(refusalMessage(resStatus, payload));
        return null;
      }

      const takeId = payload.takeId;
      takeIdRef.current = takeId;
      const token = payload.token;

      return await new Promise<FinishedTake | null>((resolve) => {
        let settled = false;
        const settle = (value: FinishedTake | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const session = createLucySession({
          inputStream: camera,
          prompt: args.prompt,
          // Already minted above; `tokenExpirationSeconds` is deliberately
          // omitted in session.ts so this is never called a second time.
          tokenProvider: async () => token,
          onStatus: (next) => setStatus(next),
          onError: (message) => {
            setStatus('error');
            setError(message);
            // No recorder yet means the session died before the first frame,
            // so nothing downstream will ever report this take. An honest zero
            // report hands the claimed seconds back (convex/chair.ts
            // finishTake); after the first frame the recorder path owns the
            // report and this must not race it.
            if (!recorderRef.current) {
              void finishTakeMutation({ takeId, durationMs: 0 }).catch(() => {});
            }
            teardownTake();
            settle(null);
          },
          onOutputStream: (stream) => {
            setOutputStream(stream);
            setStatus('streaming');
            try {
              const recorder = startTakeRecording({
                stream,
                maxSeconds: payload.maxSeconds ?? MAX_TAKE_SECONDS,
              });
              recorderRef.current = recorder;
              stopTicking();
              tickRef.current = setInterval(() => setElapsedMs(recorder.elapsedMs()), 100);

              void recorder.result
                .then(async (recording) => {
                  stopTicking();
                  setElapsedMs(recording.durationMs);
                  sessionRef.current?.close();
                  sessionRef.current = null;
                  setOutputStream(null);
                  settle({ takeId, recording });
                })
                .catch(() => {
                  stopTicking();
                  settle(null);
                });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Couldn’t record that take.');
              teardownTake();
              settle(null);
            }
          },
        });
        sessionRef.current = session;
      });
    },
    [openCamera, teardownTake, stopTicking, finishTakeMutation],
  );

  /** "That's the one" — end the take early. */
  const stopTake = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  /** Abandon a take in progress; budget stays claimed, which is the safe side. */
  const cancelTake = useCallback(() => {
    teardownTake();
    setStatus('idle');
    setElapsedMs(0);
  }, [teardownTake]);

  /** Re-steer the live feed without renegotiating. */
  const setPrompt = useCallback((prompt: string) => {
    sessionRef.current?.setPrompt(prompt);
  }, []);

  /**
   * Persist the clip and reconcile the barber's budget. The Convex call runs
   * even when the upload throws — an unrecorded take still has to give its
   * unused seconds back.
   */
  const saveRecording = useCallback(
    async (takeId: Id<'chairTakes'>, recording: TakeRecording) => {
      let videoStorageId: Id<'_storage'> | undefined;
      try {
        videoStorageId = (await upload(recording.blob)).storageId;
      } catch {
        setError('The take played but didn’t save. The angles below still work.');
      }
      await finishTakeMutation({
        takeId,
        durationMs: recording.durationMs,
        videoStorageId,
      }).catch(() => {});
      return videoStorageId;
    },
    [upload, finishTakeMutation],
  );

  // Nothing here survives unmount: a leaked camera keeps the light on and a
  // leaked session keeps billing.
  useEffect(
    () => () => {
      stopTicking();
      recorderRef.current?.cancel();
      sessionRef.current?.close();
      cameraRef.current?.getTracks().forEach((t) => t.stop());
    },
    [stopTicking],
  );

  return {
    cameraStream,
    outputStream,
    status,
    elapsedMs,
    error,
    facing,
    setError,
    openCamera,
    closeCamera,
    flipCamera,
    startTake,
    stopTake,
    cancelTake,
    setPrompt,
    saveRecording,
  };
}
