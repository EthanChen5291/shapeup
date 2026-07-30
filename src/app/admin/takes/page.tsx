'use client';

// The take debug area: recent live takes across every barber, each row pairing
// the verbatim prompt with the camera stills captured over the take and the
// footage it produced. This is the persistent sibling of TakeDebugPanel —
// that panel answers "what is Lucy working from RIGHT NOW", this page answers
// it a week later. Same visual system as /admin/feedback.

import { useCallback, useEffect, useState } from 'react';

interface SnapshotView {
  tMs: number;
  url: string | null;
}

interface DebugTakeRow {
  id: string;
  barberSlug: string | null;
  cutLabel: string;
  prompt: string;
  status: 'recorded' | 'approved' | 'discarded';
  durationMs: number;
  snapshots: SnapshotView[];
  videoUrl: string | null;
  posterUrl: string | null;
  createdAt: number;
}

type Filter = 'all' | 'approved' | 'discarded';

const STATUS_STYLES: Record<DebugTakeRow['status'], string> = {
  approved: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60',
  recorded: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  discarded: 'bg-red-950/40 text-red-400 border-red-800/60',
};

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AdminTakesPage() {
  const [rows, setRows] = useState<DebugTakeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin-takes');
      const data = await r.json().catch(() => null);
      if (!data || data.error) {
        setError(data?.error ?? 'The server didn’t respond — refresh to retry.');
        return;
      }
      setRows(data.takes);
    } catch {
      setError('Couldn’t load takes — check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
      <div className="flex items-center gap-4 mb-1">
        <h1 className="text-2xl font-bold tracking-tight">Takes</h1>
      </div>
      <p className="text-neutral-500 text-sm mb-6">
        {loading
          ? 'Loading…'
          : `${shown.length} of ${rows.length} shown · what the camera saw next to what Lucy was told`}
      </p>

      <div className="flex gap-2 mb-6">
        {(['all', 'approved', 'discarded'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded text-sm border transition-colors ${
              filter === f
                ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-amber-500'
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto px-3 py-1.5 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
        >
          refresh
        </button>
      </div>

      {error && <p className="text-red-400 mb-4">Error: {error}</p>}
      {!loading && !error && shown.length === 0 && <p className="text-neutral-500">No takes yet.</p>}

      <div className="flex flex-col gap-2">
        {shown.map((r) => (
          <div key={r.id} className="rounded-xl border p-4 bg-neutral-900 border-neutral-800">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[r.status]}`}>
                {r.status}
              </span>
              <span className="text-sm text-neutral-200">{r.cutLabel}</span>
              {r.barberSlug && <span className="text-xs text-neutral-500">/b/{r.barberSlug}</span>}
              <span className="text-xs text-neutral-500">{seconds(r.durationMs)}</span>
              <span className="ml-auto text-xs text-neutral-600">
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>

            <p className="mt-3 text-sm text-neutral-200 whitespace-pre-wrap bg-neutral-950 rounded-lg border border-neutral-800 p-3">
              {r.prompt}
            </p>

            <div className="mt-3 flex gap-4 items-start flex-wrap">
              {r.snapshots.length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                  {r.snapshots.map((s) =>
                    s.url ? (
                      <figure key={s.tMs} className="shrink-0">
                        {/* Convex-signed URL, tiny debug JPEG — nothing for next/image to optimise. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="h-20 w-auto rounded border border-neutral-800"
                          src={s.url}
                          alt={`Camera at ${seconds(s.tMs)} into the take`}
                          loading="lazy"
                        />
                        <figcaption className="text-[10px] text-neutral-600 text-center mt-0.5">
                          {seconds(s.tMs)}
                        </figcaption>
                      </figure>
                    ) : null,
                  )}
                </div>
              ) : (
                <span className="text-xs text-neutral-600">no snapshots</span>
              )}

              {r.videoUrl ? (
                <video
                  className="h-40 rounded-lg border border-neutral-800"
                  src={r.videoUrl}
                  poster={r.posterUrl ?? undefined}
                  controls
                  preload="none"
                />
              ) : (
                <span className="text-xs text-neutral-600">no video</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
