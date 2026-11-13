'use client';

// The landing hero's picture: one head turning once around while it wears every women's cut in
// the try-on catalog. It is a real render of the product's own fit and merge
// (scripts/turntable-gif.mjs), and it only plays: there is nothing to swipe or click.

import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { startMutedAutoplay } from '@/lib/mutedAutoplay';

export const HERO_TURNTABLE_VIDEO = '/landing_turntable/turntable.mp4';
/** Frame 0 of the video (a profile), so the poster and the first played frame are the same picture. */
export const HERO_TURNTABLE_POSTER = '/landing_turntable/turntable_poster.jpg';
/** The face-on frame: what visitors who asked for reduced motion see instead of the loop. */
export const HERO_TURNTABLE_STILL = '/landing_turntable/turntable_still.jpg';

/** Share of the blob's width the head's circle takes, centred on it. */
const CIRCLE_WIDTH = '82%';
// The render's background is the blob's own colour. Two fades, intersected: the circle's rim, which
// hides the seam with the blob's paper grain, and the bottom, where the render's shoulders end
// in a flat cut that would otherwise show as a line.
const SOFT_EDGE = 'radial-gradient(circle closest-side, #000 84%, transparent 100%), linear-gradient(to bottom, #000 79%, transparent 92%)';
// A little larger and lower than the render frames it, so the head fills the blob and the
// shoulders run out into the fade.
const FIT: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'translateY(4%) scale(1.08)' };

export default function HeroTurntable() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  // The video starts from the HTML, before any script runs; this only covers a blocked autoplay.
  // Visitors who asked for less motion get the face-on still instead: CSS swaps it in
  // (.hero-turntable in globals.css) and this keeps the video from running behind it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduce = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let cancel: (() => void) | null = null;
    const apply = () => {
      cancel?.();
      cancel = null;
      if (reduce?.matches) video.pause();
      else cancel = startMutedAutoplay(video);
    };
    apply();
    reduce?.addEventListener('change', apply);
    return () => { reduce?.removeEventListener('change', apply); cancel?.(); };
  }, []);

  return (
    <div className="hero-turntable" style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
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
        <video
          ref={videoRef}
          src={HERO_TURNTABLE_VIDEO}
          poster={HERO_TURNTABLE_POSTER}
          autoPlay
          className="decorative-video"
          role="img"
          aria-label={t('A head turning around in 3D while it tries on different hairstyles')}
          muted
          playsInline
          loop
          preload="auto"
          disablePictureInPicture
          style={FIT}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="hero-turntable-still" src={HERO_TURNTABLE_STILL} alt="" loading="lazy" decoding="async" style={FIT} />
      </div>
    </div>
  );
}
