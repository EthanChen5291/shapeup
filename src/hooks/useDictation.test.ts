// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDictation, type SpeechRecognizer } from './useDictation';

// A scripted stand-in for the browser engine: the test drives onresult /
// onerror / onend by hand, the way Chrome would.
class FakeRecognizer implements SpeechRecognizer {
  static instances: FakeRecognizer[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognizer['onresult'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  onend: SpeechRecognizer['onend'] = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    this.started++;
  }
  // Real engines fire onend after both stop() and abort().
  stop() {
    this.stopped++;
    this.onend?.();
  }
  abort() {
    this.aborted++;
    this.onend?.();
  }
}

function hear(rec: FakeRecognizer, ...phrases: string[]) {
  rec.onresult?.({ results: phrases.map((p) => [{ transcript: p }]) });
}

beforeEach(() => {
  FakeRecognizer.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognizer);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDictation', () => {
  test('unsupported browsers never show a mic: supported stays false without the API', async () => {
    vi.unstubAllGlobals();
    const { result } = renderHook(() => useDictation('en-US'));
    await waitFor(() => expect(result.current.supported).toBe(false));
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
  });

  test('start opens one session in the app language and streams interim words', async () => {
    const { result } = renderHook(() => useDictation('es-ES'));
    await waitFor(() => expect(result.current.supported).toBe(true));

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    const rec = FakeRecognizer.instances[0];
    expect(rec.lang).toBe('es-ES');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);

    // Interim results mutate in place; the transcript must track the rebuild.
    act(() => hear(rec, 'tighter on '));
    expect(result.current.transcript).toBe('tighter on');
    act(() => hear(rec, 'tighter on ', 'the sides'));
    expect(result.current.transcript).toBe('tighter on the sides');

    // A second start while listening must not open a second engine session.
    act(() => result.current.start());
    expect(FakeRecognizer.instances).toHaveLength(1);
  });

  test('stop keeps the words, cancel throws them away', async () => {
    const { result } = renderHook(() => useDictation('en-US'));
    await waitFor(() => expect(result.current.supported).toBe(true));

    act(() => result.current.start());
    act(() => hear(FakeRecognizer.instances[0], 'keep the fringe'));
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
    expect(result.current.transcript).toBe('keep the fringe');

    act(() => result.current.start());
    act(() => hear(FakeRecognizer.instances[1], 'scrap this'));
    act(() => result.current.cancel());
    expect(result.current.listening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(FakeRecognizer.instances[1].aborted).toBe(1);
  });

  test('a blocked mic surfaces as an error the bar can explain, and clears on retry', async () => {
    const { result } = renderHook(() => useDictation('en-US'));
    await waitFor(() => expect(result.current.supported).toBe(true));

    act(() => result.current.start());
    act(() => {
      FakeRecognizer.instances[0].onerror?.({ error: 'not-allowed' });
      FakeRecognizer.instances[0].onend?.();
    });
    expect(result.current.error).toBe('blocked');
    expect(result.current.listening).toBe(false);

    // Silence is not an error — the browser just ended the session.
    act(() => result.current.start());
    expect(result.current.error).toBeNull();
    act(() => {
      FakeRecognizer.instances[1].onerror?.({ error: 'no-speech' });
      FakeRecognizer.instances[1].onend?.();
    });
    expect(result.current.error).toBeNull();
  });

  test('unmounting mid-dictation shuts the mic off', async () => {
    const { result, unmount } = renderHook(() => useDictation('en-US'));
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    unmount();
    expect(FakeRecognizer.instances[0].aborted).toBe(1);
  });
});
