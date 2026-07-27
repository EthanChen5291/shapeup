// @vitest-environment jsdom

// The 30-second ceiling is a SPEND guard, not a UX nicety — the model bills by
// the second and convex/chair.ts has already debited exactly thirty. So the
// stop timer has to fire on its own clock, whatever the UI is doing.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { pickRecordingMimeType, startTakeRecording } from './recorder';

class FakeMediaRecorder {
  static supported: string[] = ['video/webm;codecs=vp9'];
  static last: FakeMediaRecorder | null = null;
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.includes(type);
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  timeslice?: number;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.last = this;
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk']) });
    this.onstop?.();
  }
}

const STREAM = {} as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  FakeMediaRecorder.supported = ['video/webm;codecs=vp9'];
  FakeMediaRecorder.last = null;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pickRecordingMimeType', () => {
  test('prefers VP9 when the browser has it', () => {
    FakeMediaRecorder.supported = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    expect(pickRecordingMimeType()).toBe('video/webm;codecs=vp9');
  });

  test('falls back to mp4 on Safari, which has never supported webm', () => {
    FakeMediaRecorder.supported = ['video/mp4;codecs=avc1', 'video/mp4'];
    expect(pickRecordingMimeType()).toBe('video/mp4;codecs=avc1');
  });

  test('reports honestly when nothing is recordable', () => {
    FakeMediaRecorder.supported = [];
    expect(pickRecordingMimeType()).toBeNull();
  });

  test('an engine whose isTypeSupported throws does not take the take with it', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: () => {
        throw new Error('nope');
      },
    });
    expect(pickRecordingMimeType()).toBeNull();
  });

  test('a browser with no MediaRecorder at all returns null', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickRecordingMimeType()).toBeNull();
  });
});

describe('startTakeRecording', () => {
  test('refuses up front when the browser cannot record, rather than losing the take', () => {
    FakeMediaRecorder.supported = [];
    expect(() => startTakeRecording({ stream: STREAM })).toThrow(/record/i);
  });

  test('requests timesliced chunks so a crash mid-take still leaves data', () => {
    startTakeRecording({ stream: STREAM });
    expect(FakeMediaRecorder.last!.timeslice).toBe(1000);
  });

  test('stops itself at the ceiling even if nothing ever calls stop()', async () => {
    const onAutoStop = vi.fn();
    const recorder = startTakeRecording({ stream: STREAM, maxSeconds: 30, onAutoStop });

    expect(FakeMediaRecorder.last!.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(FakeMediaRecorder.last!.state).toBe('recording');

    await vi.advanceTimersByTimeAsync(1_500);
    expect(onAutoStop).toHaveBeenCalledTimes(1);

    const result = await recorder.result;
    expect(result.mimeType).toBe('video/webm;codecs=vp9');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(30_000);
  });

  test('an early stop ends the take there and disarms the ceiling', async () => {
    const onAutoStop = vi.fn();
    const recorder = startTakeRecording({ stream: STREAM, maxSeconds: 30, onAutoStop });

    await vi.advanceTimersByTimeAsync(8_000);
    recorder.stop();

    const result = await recorder.result;
    expect(result.durationMs).toBeGreaterThanOrEqual(8_000);
    expect(result.durationMs).toBeLessThan(30_000);

    // The ceiling must not fire afterwards and re-stop an inactive recorder.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  test('elapsed time freezes once the take has ended', async () => {
    const recorder = startTakeRecording({ stream: STREAM });
    await vi.advanceTimersByTimeAsync(5_000);
    recorder.stop();
    await recorder.result;

    const frozen = recorder.elapsedMs();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recorder.elapsedMs()).toBe(frozen);
  });

  test('stopping twice is harmless', async () => {
    const recorder = startTakeRecording({ stream: STREAM });
    await vi.advanceTimersByTimeAsync(1_000);
    recorder.stop();
    recorder.stop();
    await expect(recorder.result).resolves.toBeTruthy();
  });

  test('cancel produces no file and leaves no unhandled rejection', async () => {
    const recorder = startTakeRecording({ stream: STREAM });
    await vi.advanceTimersByTimeAsync(1_000);
    recorder.cancel();
    await expect(recorder.result).rejects.toThrow(/cancelled/);
    expect(FakeMediaRecorder.last!.state).toBe('inactive');
  });
});
