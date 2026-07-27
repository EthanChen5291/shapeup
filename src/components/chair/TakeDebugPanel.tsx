'use client';

// Developer-facing: the exact instruction Lucy is working from and a low-res
// still of what the camera saw at take start, side by side. This is the panel
// that answers "why did the mirror do THAT" — when an output surprises anyone,
// the first question is what was actually sent, not what the UI meant to send.
//
// Deliberately not translated: the prompt is machine copy in its source
// language, and the panel exists for whoever is debugging, not for the client
// in the chair. Collapsed by default so it never competes with the mirror.

import type { TakeDebugInfo } from '@/hooks/useChairTake';

export default function TakeDebugPanel({ info }: { info: TakeDebugInfo | null }) {
  if (!info) return null;
  return (
    <details className="chair-debug">
      <summary className="chair-debug-summary font-mono">Debug — what Lucy was sent</summary>
      <div className="chair-debug-body">
        {info.snapshotUrl ? (
          // A data URL, so next/image has nothing to optimise here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="chair-debug-shot"
            src={info.snapshotUrl}
            alt="Low-res snapshot of the camera when the take started"
          />
        ) : (
          <span className="chair-debug-noshot font-sans">no snapshot</span>
        )}
        <p className="chair-debug-prompt font-mono">{info.prompt}</p>
      </div>
    </details>
  );
}
