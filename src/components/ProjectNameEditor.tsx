'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

// The editing outline extends this far past the name on each side (a longer
// oval than the text box) and its soft glow needs PAD of room to fade out.
const OUTLINE_EXTRA_X = 16;
const OUTLINE_PAD = 8;

/**
 * The pill outline as four strokes from the top and bottom centre to the rounded
 * ends. They're drawn twice, blurred, and split at the pill line: inside (facing
 * the name) a soft gradient that strengthens toward the line and stops there;
 * outside a faint airbrush that dissipates — a backlit glow, not a drawn ring.
 */
export function outlineSegments(w: number, h: number, pad: number): string[] {
  const x0 = pad, x1 = pad + w, y0 = pad, y1 = pad + h;
  const r = h / 2, cx = pad + w / 2, cy = pad + r;
  return [
    `M ${cx} ${y0} L ${x0 + r} ${y0} A ${r} ${r} 0 0 0 ${x0} ${cy}`, // top → left end
    `M ${cx} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${cy}`, // bottom → left end
    `M ${cx} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${cy}`, // top → right end
    `M ${cx} ${y1} L ${x1 - r} ${y1} A ${r} ${r} 0 0 0 ${x1} ${cy}`, // bottom → right end
  ];
}

function EditOutline({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [box, setBox] = useState({ w: 0, h: 0 });
  // Appearance 0→1, like a light behind the name being moved closer: the glow
  // starts dim and diffuse, then brightens and tightens. rAF-driven because the
  // blur radius is an SVG attribute.
  const [glow, setGlow] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setGlow(1); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 480);
      setGlow(1 - Math.pow(1 - t, 3)); // ease-out
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [targetRef]);

  const w = box.w + 2 * OUTLINE_EXTRA_X;
  const h = box.h;
  const W = w + 2 * OUTLINE_PAD;
  const H = h + 2 * OUTLINE_PAD;
  return (
    <svg
      className="pne-outline"
      width={W}
      height={H}
      style={{ left: -(OUTLINE_EXTRA_X + OUTLINE_PAD), top: -OUTLINE_PAD }}
      aria-hidden
    >
      <defs>
        <filter id={`pne-blur-${uid}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={2 + (1 - glow) * 4.5} />
        </filter>
        {/* Outside the pill line: a light airbrush that dissipates away from the name. */}
        <mask id={`pne-out-${uid}`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <rect width={W} height={H} fill="white" />
          <rect x={OUTLINE_PAD} y={OUTLINE_PAD} width={w} height={h} rx={h / 2} fill="black" />
        </mask>
        {/* Inside the line (facing the name): a gradient that strengthens toward the
            line and stops sharply at it. */}
        <mask id={`pne-in-${uid}`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <rect x={OUTLINE_PAD} y={OUTLINE_PAD} width={w} height={h} rx={h / 2} fill="white" />
        </mask>
      </defs>
      {h > 0 && (['out', 'in'] as const).map((side) => (
        <g key={side} mask={`url(#pne-${side}-${uid})`} opacity={glow}>
          <g filter={`url(#pne-blur-${uid})`}>
            {outlineSegments(w, h, OUTLINE_PAD).map((d, i) => (
              <path key={i} d={d} className={`pne-outline-stroke pne-outline-${side}`} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}

/**
 * Inline, editable project name. Click the name to type over it; a soft pill
 * outline draws itself around it while editing. Enter or clicking away saves,
 * Escape discards.
 */
export default function ProjectNameEditor({
  projectId,
  name,
  compact = false,
  title = false,
}: {
  projectId: Id<'projects'>;
  name?: string;
  compact?: boolean;
  /** Large centred title (the studio viewport) instead of the header lockup. */
  title?: boolean;
}) {
  const rename = useMutation(api.projects.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);
  // Mirrors `editing` synchronously so commit/cancel stay idempotent even when
  // Enter and the input's blur both try to close the editor.
  const editingRef = useRef(false);

  // Keep the draft synced to the latest saved name while we're not editing.
  useEffect(() => {
    if (!editing && name != null) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing]);

  const display = (name ?? '').trim() || 'Untitled cut';

  const beginEdit = () => {
    editingRef.current = true;
    setDraft((name ?? '').trim());
    setEditing(true);
  };

  const commit = async () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (name ?? '').trim()) {
      try {
        await rename({ projectId, name: next });
      } catch (e) {
        console.error('[ProjectNameEditor] rename failed:', e);
      }
    }
  };

  const cancel = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setDraft((name ?? '').trim());
    setEditing(false);
  };

  return (
    <div className={`pne-root${compact ? ' pne-compact' : ''}${title ? ' pne-title' : ''}`}>
      {editing ? (
        <span className="pne-shell">
        <span ref={fieldRef} className="pne-field pne-field--editing">
          {/* invisible sizer auto-grows the field to the text width */}
          <span className="pne-sizer" aria-hidden>
            {draft || display}
          </span>
          <input
            ref={inputRef}
            className="pne-input"
            value={draft}
            maxLength={60}
            aria-label="Project name"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={() => void commit()}
          />
        </span>
        {/* After the field on purpose: an earlier sibling's layout effect runs before
            this field's ref is attached, so the outline would measure nothing. */}
        <EditOutline targetRef={fieldRef} />
        </span>
      ) : (
        <button type="button" className="pne-name" onClick={beginEdit} title="Click to rename">
          {display}
        </button>
      )}
    </div>
  );
}
