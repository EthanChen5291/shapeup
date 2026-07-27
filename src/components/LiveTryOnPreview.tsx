'use client';

// ============================================================
// LiveTryOnPreview — the diagram shown on the last screen before a take.
//
// Naming the parts in prose ("a prompt box, suggestions below it") answers
// *what is on screen* but not *what do I do with it*, so this plays the loop
// instead: a suggestion tapped, a sentence typed, the right pane catching up a
// beat later. Thirty seconds stops being a countdown to survive and starts
// being time to spend.
//
// It sits on the card's ready screen and the chair's style screen — NOT on
// either consent screen, which only renders for a client with no consentAt and
// so is invisible to everyone who has agreed once. The `tone` prop is the only
// difference between the two homes: the chair is a dark studio surface.
//
// It draws the live screen's real shape — camera left, result right, prompt
// bar under both, suggestion chips under that (the desktop split in
// `.bt-live .bt-stage`). Two rules keep it honest:
//
//  * The faces are flat silhouettes and the hair is hand-drawn. Nothing here
//    is model output, so nothing here can be read as a promise about the
//    result — same rule the landing page's scripted scenes follow.
//  * The chips are real cuts from the catalog, with the real preview art, so
//    the row is the row they are about to see.
//
// Motion: a prompt re-steers the cut that is already on screen, it does not
// replace it — so a typed line stretches or tightens the same hair shape
// (scaleY) while only a tapped chip swaps the shape outright. The timing is
// deliberately uneven; a fixed per-character interval reads as a machine
// typing, which is the one thing this screen is trying not to look like.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { hairstyleBySlug } from '@/data/hairstyles';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useT } from '@/lib/i18n';

/** The suggestion row, in catalog order — art and labels come from the catalog. */
const CHIP_SLUGS = [
  'low-taper-fade-textured-fringe',
  'broccoli-perm-taper-fade',
  'curtain-fringe-mid-fade',
] as const;

type HairShape = 'fade' | 'curls' | 'fringe';

/** Which drawing each chip lands on. */
const CHIP_SHAPE: Record<string, HairShape> = {
  'low-taper-fade-textured-fringe': 'fade',
  'broccoli-perm-taper-fade': 'curls',
  'curtain-fringe-mid-fade': 'fringe',
};

type Beat =
  | { kind: 'chip'; chip: number }
  /** `mod` is how the typed line steers the shape already on screen. */
  | { kind: 'prompt'; text: string; mod: -1 | 1 };

const BEATS: Beat[] = [
  { kind: 'chip', chip: 0 },
  { kind: 'prompt', text: 'tighter on the sides', mod: -1 },
  { kind: 'chip', chip: 1 },
  { kind: 'prompt', text: 'more volume on top', mod: 1 },
  { kind: 'chip', chip: 2 },
  { kind: 'prompt', text: 'a little longer at the front', mod: 1 },
];

/** Keystroke gap. Wide spread, wider after a space — hands are not metronomes. */
function keyDelay(char: string): number {
  return char === ' ' ? 90 + Math.random() * 100 : 34 + Math.random() * 66;
}

/** Where the loop is halfway through — what `prefers-reduced-motion` gets, drawn once. */
const REST = { chip: 1, shape: 'curls' as HairShape, text: 'more volume on top' };

export default function LiveTryOnPreview({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const t = useT();
  const still = useMediaQuery('(prefers-reduced-motion: reduce)');

  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [firing, setFiring] = useState(false);
  const [tapped, setTapped] = useState(-1);
  const [thinking, setThinking] = useState(false);
  // Opens on the state the last beat leaves behind, so the first beat is a
  // change like every other one and the loop has no visible seam.
  const [chip, setChip] = useState(CHIP_SLUGS.length - 1);
  const [shape, setShape] = useState<HairShape>('fringe');
  const [mod, setMod] = useState<-1 | 0 | 1>(1);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Reduced motion gets the rest state the loop settles on, drawn once.
    if (still) return;

    let stopped = false;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer.current = setTimeout(resolve, ms);
      });

    void (async () => {
      let i = 0;
      while (!stopped) {
        const next = BEATS[i % BEATS.length];

        if (next.kind === 'chip') {
          setTapped(next.chip);
          await wait(180);
          if (stopped) return;
          setTapped(-1);
          setChip(next.chip);
          setThinking(true);
          await wait(520);
          if (stopped) return;
          setShape(CHIP_SHAPE[CHIP_SLUGS[next.chip]]);
          setMod(0);
          setThinking(false);
          await wait(1500);
        } else {
          setTyping(true);
          for (const char of next.text) {
            await wait(keyDelay(char));
            if (stopped) return;
            setTyped((sofar) => sofar + char);
          }
          setTyping(false);
          await wait(520);
          if (stopped) return;
          setFiring(true);
          setTyped('');
          setThinking(true);
          await wait(340);
          if (stopped) return;
          setFiring(false);
          await wait(380);
          if (stopped) return;
          setMod(next.mod);
          setThinking(false);
          await wait(1500);
        }
        if (stopped) return;
        i += 1;
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [still]);

  const cuts = CHIP_SLUGS.map((slug) => hairstyleBySlug(slug)).filter((cut) => cut !== undefined);

  return (
    <figure
      className={`ltp${tone === 'dark' ? ' is-dark' : ''}`}
      role="img"
      aria-label={t(
        'A sketch of the next screen: your camera on the left, the same view with the haircut on the right, a prompt box under both, and cut suggestions below that.',
      )}
    >
      <div className="ltp-stage" aria-hidden>
        <div className="ltp-pane">
          <Face shape="own" />
          <span className="ltp-tag font-mono">{t('You##camera')}</span>
          <span className="ltp-rec font-mono">
            <i className="ltp-dot" />
            {t('Live##camera')}
          </span>
        </div>

        <div className={`ltp-pane is-result${thinking ? ' is-thinking' : ''}`}>
          <Face shape={still ? REST.shape : shape} mod={still ? 0 : mod} />
          <span className="ltp-tag font-mono">{t('With the cut')}</span>
          <span className="ltp-clock font-mono">0:30</span>
        </div>
      </div>

      <div className={`ltp-prompt${typing ? ' is-typing' : ''}`} aria-hidden>
        <span className="ltp-line font-sans">
          {still ? REST.text : typed}
          <i className="ltp-caret" />
        </span>
        <span className={`ltp-send${firing ? ' is-firing' : ''}`}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>

      <ul className="ltp-chips" aria-hidden>
        {cuts.map((cut, i) => (
          <li key={cut.slug}>
            <span
              className={`ltp-chip${(still ? REST.chip : chip) === i ? ' is-on' : ''}${tapped === i ? ' is-tapped' : ''}`}
            >
              <img src={`/hair-previews/${cut.slug}.png`} alt="" width={18} height={18} loading="lazy" />
              {/* The catalog label up to its first comma — the cut's name without
                  the detail, which is all a chip this size can carry. Japanese
                  labels separate with a full-width 、so both scripts cut here. */}
              {t(cut.label).split(/[,、]/)[0]}
            </span>
          </li>
        ))}
      </ul>

      <figcaption className="ltp-cap font-mono">
        {t('A sketch of the screen — not a preview of your result.')}
      </figcaption>
    </figure>
  );
}

/**
 * One flat person, drawn head-on. The body never changes — it is the same
 * camera on both sides of the stage, so both panes breathe on the same clock.
 */
function Face({ shape, mod = 0 }: { shape: HairShape | 'own'; mod?: -1 | 0 | 1 }) {
  return (
    <svg className="ltp-face" viewBox="0 0 100 125" aria-hidden focusable="false">
      <g className="ltp-body">
        <path d="M6,125 C10,101 28,93 50,93 C72,93 90,101 94,125 Z" />
        <path d="M43,74 h14 v20 h-14 Z" />
        <circle cx="30.5" cy="58" r="3.4" />
        <circle cx="69.5" cy="58" r="3.4" />
        <ellipse cx="50" cy="54" rx="20" ry="25" />
      </g>

      {/* Every shape's outer edge clears the top of the skull (y≈29) — a cap of
          hair, not a headband sitting on a bald head. */}
      {shape === 'own' ? (
        <g className="ltp-hair is-on is-own">
          <path d="M29,60 C25,15 75,15 71,60 C69,46 62,40 50,40 C38,40 31,46 29,60 Z" />
        </g>
      ) : (
        <>
          <g className={`ltp-hair${shape === 'fade' ? ' is-on' : ''}`} data-mod={mod}>
            <path d="M31,58 C29,17 71,17 69,58 C68,47 62,43 50,43 C38,43 32,47 31,58 Z" />
          </g>
          <g className={`ltp-hair${shape === 'curls' ? ' is-on' : ''}`} data-mod={mod}>
            <path d="M28,58 C24,14 76,14 72,58 C70,45 62,39 50,39 C38,39 30,45 28,58 Z" />
            <circle cx="33" cy="38" r="6" />
            <circle cx="41" cy="32" r="7" />
            <circle cx="50" cy="29" r="7.5" />
            <circle cx="59" cy="32" r="7" />
            <circle cx="67" cy="38" r="6" />
            <circle cx="29" cy="47" r="5" />
            <circle cx="71" cy="47" r="5" />
          </g>
          <g className={`ltp-hair${shape === 'fringe' ? ' is-on' : ''}`} data-mod={mod}>
            <path d="M28,58 C25,13 75,13 72,58 C71,70 70,74 68,79 C66,72 66,64 65,57 C61,52 57,50 52,52 C51,56 49,56 48,52 C43,50 39,52 35,57 C34,64 34,72 32,79 C30,74 29,70 28,58 Z" />
          </g>
        </>
      )}
    </svg>
  );
}
