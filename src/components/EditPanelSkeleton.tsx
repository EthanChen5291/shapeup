'use client';

/**
 * EditPanelSkeleton — placeholder for the studio toolbox while the loading
 * shadow (BuildGhost) is up. Mirrors the toolbox's three cards as soft pulsing
 * shapes, Instagram-style, so the sidebar reads as "loading" rather than
 * dimmed or blank:
 *
 *   prompt card      — the text box, then the Apply bar + image button
 *   trending cuts    — search pill + gender toggle, then equal-length rows
 *   show your barber — a title line and the row of action buttons
 *
 * Every line starts on the same left edge (the cards share one inner padding)
 * and the list rows are all one length, so it reads calm rather than ragged.
 * Pure presentation: no data, no handlers.
 */

import type { CSSProperties } from 'react';

/** Inner padding shared by every card, so all the lines start on one edge. */
const PAD = 16;
/** Text lines: thin, one length everywhere. */
const LINE_H = 12;
const LINE_W = '58%';
/** Button shapes: slim, so nothing reads as a heavy slab. */
const BTN_H = 28;

function Block({ w, h, r = 8, i = 0, className = '', style }: { w: number | string; h: number; r?: number; i?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={`skel skel-pulse ${className}`}
      style={{ display: 'block', flexShrink: 0, width: w, height: h, borderRadius: r, ['--i' as string]: i, ...style } as CSSProperties}
    />
  );
}

export function EditPanelSkeleton({ isMobile = false, className = '', style }: { isMobile?: boolean; className?: string; style?: CSSProperties }) {
  const rows = isMobile ? 3 : 4;
  return (
    <div
      role="status"
      aria-label="Loading toolbox"
      data-testid="edit-panel-skeleton"
      className={`flex flex-col ${isMobile ? 'gap-2' : 'gap-3'} ${className}`}
      style={style}
    >
      {/* Prompt card: placeholder text lines, then Apply + the image button */}
      <div className="skel-card flex flex-col" style={{ padding: PAD, gap: 14 }}>
        <Block w={LINE_W} h={LINE_H} r={6} i={0} />
        <Block w={LINE_W} h={LINE_H} r={6} i={0} />
        <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
          <Block w="auto" h={BTN_H} r={BTN_H / 2} i={1} style={{ flex: 1 }} />
          <Block w={BTN_H} h={BTN_H} r={BTN_H / 2} i={1} />
        </div>
      </div>

      {/* Trending cuts: search pill + gender toggle, then the list rows */}
      <div className="skel-card flex flex-col" style={{ padding: PAD }}>
        <div className="flex items-center gap-2" style={{ paddingBottom: 6 }}>
          <Block w="auto" h={BTN_H} r={BTN_H / 2} i={2} style={{ flex: 1 }} />
          <Block w={BTN_H} h={BTN_H} r={BTN_H / 2} i={2} />
        </div>
        {Array.from({ length: rows }, (_, k) => (
          <div key={k} className="flex items-center" style={{ height: 40 }} data-testid="edit-panel-skeleton-row">
            <Block w={LINE_W} h={LINE_H} r={6} i={3 + k} />
          </div>
        ))}
      </div>

      {/* Show your barber: title line + the 360° / recap / try-on buttons */}
      <div className="skel-card flex flex-col" data-testid="edit-panel-skeleton-barber" style={{ padding: PAD, gap: 14 }}>
        <Block w={LINE_W} h={LINE_H} r={6} i={3 + rows} />
        <div className="flex items-center gap-2">
          {[0, 1, 2].map(k => <Block key={k} w={40} h={BTN_H} r={BTN_H / 2} i={4 + rows} />)}
        </div>
      </div>
    </div>
  );
}
