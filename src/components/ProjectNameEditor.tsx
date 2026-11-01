'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

/**
 * Inline, editable project name. Click the name to type over it, in place:
 * the editor has exactly the display's box (same font, padding, border), so
 * nothing moves and nothing clips. Enter or clicking away saves, Escape discards.
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
        <span className="pne-field pne-field--editing">
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
      ) : (
        <button type="button" className="pne-name" onClick={beginEdit} title="Click to rename">
          {display}
        </button>
      )}
    </div>
  );
}
