'use client';

// The landing hero's picture: a head turning once around while it wears the try-on catalog.
// There are two renders, the women's catalog on one head and the men's on another, both made
// by scripts/turntable-gif.mjs from the product's own fit and merge. The arrows at its sides
// switch between them (lib/heroSwitch); nothing else is controllable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useArmAfterLoad } from '@/hooks/useVideoArming';
import { switchFrame } from '@/lib/heroSwitch';
import { useT } from '@/lib/i18n';
import { startMutedAutoplay } from '@/lib/mutedAutoplay';

export interface HeroClip {
  id: string;
  video: string;
  /** Frame 0 of the video (a profile), so the poster and the first played frame are the same picture. */
  poster: string;
  /** The face-on frame: what visitors who asked for reduced motion see instead of the loop. */
  still: string;
}

/** Both loops are one 6 s turn on the same schedule, so a switch lands on the same head angle. */
export const HERO_CLIPS: HeroClip[] = [
  { id: 'women', video: '/landing_turntable/turntable.mp4', poster: '/landing_turntable/turntable_poster.jpg', still: '/landing_turntable/turntable_still.jpg' },
  { id: 'men', video: '/landing_turntable/turntable_men.mp4', poster: '/landing_turntable/turntable_men_poster.jpg', still: '/landing_turntable/turntable_men_still.jpg' },
];

/** Share of the blob's width the head's circle takes, centred on it. */
const CIRCLE_WIDTH = '82%';
// The renders' background is the blob's own colour. Two fades, intersected: the circle's rim, which
// hides the seam with the blob's paper grain, and the bottom, where the render's shoulders end
// in a flat cut that would otherwise show as a line.
const SOFT_EDGE = 'radial-gradient(circle closest-side, #000 84%, transparent 100%), linear-gradient(to bottom, #000 79%, transparent 92%)';
const circleTransform = (scale: number) => `translate(-50%, -50%) scale(${scale})`;
// A little larger and lower than the render frames it, so the head fills the blob and the
// shoulders run out into the fade.
const FIT: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'translateY(4%) scale(1.08)' };

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  // Two strokes along the sides of a triangle a little narrower than it is tall.
  return (
    <svg width="12" height="28" viewBox="0 0 12 28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={dir === 'left' ? '10,2 2,14 10,26' : '2,2 10,14 2,26'} />
    </svg>
  );
}

export default function HeroTurntable() {
  const t = useT();
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const circle = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const switching = useRef(false);
  const reduced = useRef(false);
  const frame = useRef(0);

  // The first clip is in the HTML and starts by itself. The second waits until the page has
  // loaded (or an arrow is about to be used), so it never competes with the first paint.
  const afterLoad = useArmAfterLoad();
  const [wanted, setWanted] = useState(false);
  const armed = afterLoad || wanted;
  const arm = useCallback(() => setWanted(true), []);

  // Plays on its own, except for visitors who asked for less motion: CSS swaps the video for the
  // face-on still (.hero-turntable in globals.css) and this keeps the video from running behind it.
  useEffect(() => {
    const reduce = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let cancel: (() => void) | null = null;
    const apply = () => {
      cancel?.();
      cancel = null;
      reduced.current = !!reduce?.matches;
      const video = videos.current[shownRef.current];
      if (reduced.current) videos.current.forEach((v) => v?.pause());
      else if (video) cancel = startMutedAutoplay(video);
    };
    apply();
    reduce?.addEventListener('change', apply);
    return () => { reduce?.removeEventListener('change', apply); cancel?.(); cancelAnimationFrame(frame.current); };
  }, []);

  const switchClip = useCallback((step: number) => {
    if (switching.current) return;
    const from = shownRef.current;
    const to = (from + step + HERO_CLIPS.length) % HERO_CLIPS.length;
    const show = () => { shownRef.current = to; setShown(to); };
    setWanted(true);
    if (reduced.current) { show(); return; } // stills: nothing to animate

    const cur = videos.current[from];
    const next = videos.current[to];
    if (next) {
      // Run the incoming loop alongside the outgoing one, from the same moment of the turn.
      if (!next.getAttribute('src')) next.src = HERO_CLIPS[to].video;
      next.muted = true;
      if (cur) next.currentTime = cur.currentTime;
      void next.play().catch(() => {});
    }
    switching.current = true;
    const started = performance.now();
    let swapped = false;
    const tick = (now: number) => {
      const f = switchFrame(now - started);
      if (circle.current) circle.current.style.transform = circleTransform(f.scale);
      if (cur) cur.playbackRate = f.rate;
      if (next) next.playbackRate = f.rate;
      // Swap once the incoming loop has a frame at the synced time (a video that is still seeking
      // paints nothing); if it never gets there, swap anyway as the switch ends.
      if (f.swapped && !swapped && (f.done || !next || (next.readyState >= 2 && !next.seeking))) { swapped = true; show(); }
      if (f.done) { cur?.pause(); switching.current = false; return; }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  return (
    <div className="hero-turntable" style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
      <div
        ref={circle}
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: circleTransform(1),
          width: CIRCLE_WIDTH,
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          overflow: 'hidden',
          maskImage: SOFT_EDGE,
          WebkitMaskImage: SOFT_EDGE,
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
        }}
      >
        {HERO_CLIPS.map((clip, i) => (
          <div key={clip.id} data-clip={clip.id} data-shown={i === shown} style={{ position: 'absolute', inset: 0, opacity: i === shown ? 1 : 0, transition: 'opacity 90ms linear' }}>
            <video
              ref={(el) => { videos.current[i] = el; }}
              src={i === 0 || armed ? clip.video : undefined}
              poster={clip.poster}
              // The first clip starts from the HTML, before any script has run.
              autoPlay={i === 0}
              className="decorative-video"
              role="img"
              aria-label={t('A head turning around in 3D while it tries on different hairstyles')}
              aria-hidden={i !== shown}
              muted
              playsInline
              loop
              preload="auto"
              disablePictureInPicture
              style={FIT}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-turntable-still" src={clip.still} alt="" loading="lazy" decoding="async" style={FIT} />
          </div>
        ))}
      </div>

      <button type="button" className="hero-turntable-arrow" style={{ left: '1%' }} aria-label={t('Previous model')} onClick={() => switchClip(-1)} onPointerEnter={arm} onFocus={arm}>
        <Chevron dir="left" />
      </button>
      <button type="button" className="hero-turntable-arrow" style={{ right: '1%' }} aria-label={t('Next model')} onClick={() => switchClip(1)} onPointerEnter={arm} onFocus={arm}>
        <Chevron dir="right" />
      </button>
    </div>
  );
}
