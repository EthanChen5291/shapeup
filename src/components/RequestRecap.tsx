'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';

export interface EditPromptEntry {
  prompt: string;
  at: number;
}

/**
 * Recap: what the user asked for to get the cut they have now. Every edit starts
 * from the original selfie (EditPanel never chains edits), so the cut on screen
 * comes from the LATEST request alone — earlier requests are listed as previous
 * tries, not as steps toward it.
 */
export default function RequestRecap({ prompts, onClose }: { prompts: EditPromptEntry[]; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const latest = prompts.at(-1);
  const earlier = prompts.slice(0, -1).reverse();
  const when = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return createPortal(
    <div className="recap-backdrop" onClick={onClose}>
      <div
        className="recap-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="recap-head">
          <h2 id="recap-title" className="recap-title">{t('Your requests')}</h2>
          <button type="button" className="recap-close" onClick={onClose} aria-label={t('Close')} autoFocus>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {!latest ? (
          <p className="recap-empty">{t('No requests yet. Describe a cut and press Apply — the request behind each finished cut shows up here.')}</p>
        ) : (
          <>
            <div className="recap-section">
              <span className="recap-label">{t('This cut')}</span>
              <p className="recap-current">{latest.prompt}</p>
              <span className="recap-when">{when(latest.at)}</span>
            </div>
            {earlier.length > 0 && (
              <div className="recap-section">
                <span className="recap-label">{t('Earlier tries')}</span>
                <ol className="recap-list">
                  {earlier.map((e) => (
                    <li key={`${e.at}-${e.prompt}`}>
                      <span>{e.prompt}</span>
                      <span className="recap-when">{when(e.at)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="recap-note">{t('Each request starts from your original selfie, so this cut comes from the latest one.')}</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
