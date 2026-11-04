'use client';

/**
 * PrebakeCalibration — admin sliders for placing a prebaked try-on hairstyle.
 *
 * Renders nothing unless the try-on state is in calibration mode (admin) and a
 * style is selected. Each slider re-merges the hair live (debounced in the
 * hook); Submit records the values for that cut in Convex so they can be baked
 * into src/data/prebakeTransforms.ts as the default for everyone.
 */

import { useState } from 'react';
import type { QuickTryOnsState } from './QuickTryOns';
import type { PrebakeTransform } from '@/lib/splatMerge';
import styles from './PrebakeCalibration.module.css';

type Field = { key: keyof PrebakeTransform; label: string; min: number; max: number; step: number; digits: number; hint: string; invert?: boolean };

// `invert` flips a field's sign on the slider. Not needed for dz: object +z is UP
// on screen (checked on the bytes and by eye), so raw dz already reads as "up".
export const CALIBRATION_FIELDS: readonly Field[] = [
  { key: 'scale', label: 'Size', min: 2.0, max: 3.6, step: 0.005, digits: 3, hint: 'Overall hair size' },
  { key: 'dz', label: 'Up / down', min: -0.4, max: 0.4, step: 0.005, digits: 3, hint: 'Positive raises the hair' },
  { key: 'dy', label: 'Front / back', min: -0.4, max: 0.4, step: 0.005, digits: 3, hint: 'Positive moves it toward the back of the head' },
  { key: 'dx', label: 'Left / right', min: -0.3, max: 0.3, step: 0.005, digits: 3, hint: "Positive moves it to the viewer's right" },
  { key: 'alpha', label: 'Hair density', min: 0.5, max: 3, step: 0.05, digits: 2, hint: '1 = as baked; higher is less see-through' },
  { key: 'headAlpha', label: 'Head density', min: 0.5, max: 3, step: 0.05, digits: 2, hint: 'Buzz-cut base opacity (scalp showing through)' },
];

export function PrebakeCalibration({ state }: { state: QuickTryOnsState }) {
  const { calibrate, selected, selectedCut, transform, setTransform, commitTransform, resetTransform, submitCalibration, calibrationStatus, rebuildBase, rebuilding, styleError } = state;
  const [note, setNote] = useState('');
  if (!calibrate || !selected || !selectedCut || !transform) return null;

  return (
    <form
      className={styles.panel}
      data-testid="prebake-calibration"
      onSubmit={(e) => { e.preventDefault(); void submitCalibration(note.trim() || undefined); setNote(''); }}
      aria-label="Calibrate hair placement"
    >
      <div className={styles.head}>
        <span className={styles.title}>Calibrate</span>
        <span className={styles.cut} title={selected.id}>{selectedCut.name} · {selected.label}</span>
      </div>
      {CALIBRATION_FIELDS.map((f) => {
        const raw = transform[f.key];
        const shown = f.invert ? -raw : raw;
        return (
          <label key={f.key} className={styles.row} title={f.hint}>
            <span className={styles.label}>{f.label}</span>
            <input
              className={styles.range}
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={shown}
              aria-label={f.label}
              // Live value while dragging; re-merge once released (pointer, touch or key).
              onChange={(e) => {
                const v = Number(e.target.value);
                setTransform({ [f.key]: f.invert ? -v : v } as Partial<PrebakeTransform>, { merge: false });
              }}
              onPointerUp={commitTransform}
              onTouchEnd={commitTransform}
              onKeyUp={commitTransform}
            />
            <span className={styles.value}>{shown.toFixed(f.digits)}</span>
          </label>
        );
      })}
      <div className={styles.actions}>
        <input
          className={styles.note}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional): what looks right?"
          aria-label="Calibration note"
          maxLength={200}
        />
        <button type="button" className={styles.btn} onClick={resetTransform}>Reset</button>
        <button type="submit" className={`${styles.btn} ${styles.submit}`} disabled={calibrationStatus === 'saving'}>
          {calibrationStatus === 'saving' ? 'Saving…' : 'Submit'}
        </button>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => void rebuildBase()}
          disabled={rebuilding}
          title="Re-run the buzz-cut edit + 3D build with the current (matte, no-shine) prompt"
        >
          {rebuilding ? 'Rebuilding base… (~30 s)' : 'Rebuild buzz-cut base'}
        </button>
      </div>
      <div className={styles.status} role="status">
        {styleError
          ? `Couldn't load ${styleError.variantId.split('_').pop()} (${styleError.message}) — kept the previous style.`
          : calibrationStatus === 'saved' ? 'Saved — recorded for this cut.' : calibrationStatus === 'error' ? 'Could not save. Try again.' : ''}
      </div>
    </form>
  );
}
