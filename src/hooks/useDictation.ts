'use client';

// ─── Mic dictation for the prompt bar ───
// Thin wrapper over the Web Speech API (SpeechRecognition). The chair faces a
// barber with one hand free, so speaking the tweak beats typing it — but the
// API only exists on some browsers, so `supported` gates whether the mic
// renders at all rather than showing a button that can't work.
//
// Lifecycle: start() opens one recognition session and streams interim words
// into `transcript`; stop() ends it and KEEPS the words; cancel() ends it and
// THROWS THEM AWAY. Browsers also end a session on their own after a silence,
// which lands as a stop — the words stay, because trailing off mid-sentence
// shouldn't eat what was already said.

import { useCallback, useEffect, useRef, useState } from 'react';

// lib.dom.d.ts still doesn't ship SpeechRecognition types, so the shape used
// here is declared locally — only the members this hook touches.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface RecognitionErrorEvent {
  error: string;
}
export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognizerCtor = new () => SpeechRecognizer;

function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecognizerCtor | null;
}

export interface Dictation {
  /** False until the browser is known to have the API (and during SSR). */
  supported: boolean;
  listening: boolean;
  /** Everything heard this session, interim words included. */
  transcript: string;
  /** Human-actionable failure (mic blocked), or null. Cleared on next start. */
  error: 'blocked' | 'failed' | null;
  start(): void;
  /** End the session, keeping the transcript. */
  stop(): void;
  /** End the session and clear the transcript. */
  cancel(): void;
}

export function useDictation(lang: string): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<'blocked' | 'failed' | null>(null);
  const recRef = useRef<SpeechRecognizer | null>(null);

  // Effect, not initial state: window doesn't exist during SSR, and hydration
  // must match the server render before the mic pops in.
  useEffect(() => {
    setSupported(recognizerCtor() !== null);
  }, []);

  // A session left running when the screen unmounts would keep the mic hot.
  useEffect(() => () => recRef.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = recognizerCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      // Rebuild from scratch every event: results is the whole session, and
      // interim entries mutate in place as the engine re-hears them.
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setTranscript(text.trim());
    };
    rec.onerror = (e) => {
      // 'aborted' is cancel() doing its job and 'no-speech' is just silence;
      // neither is news. Permission problems are — the barber has to know why
      // nothing happened.
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'blocked' : 'failed');
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    setTranscript('');
    setError(null);
    setListening(true);
    rec.start();
  }, [lang]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const cancel = useCallback(() => {
    setTranscript('');
    recRef.current?.abort();
  }, []);

  return { supported, listening, transcript, error, start, stop, cancel };
}
