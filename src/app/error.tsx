'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('[global-error]', error.digest ?? error.message);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--biscuit)] px-6 text-[var(--ink)]">
      <section className="max-w-md rounded-md border border-[rgba(42,32,26,0.14)] bg-[var(--cream)] p-6 text-center">
        <h1 className="font-sans text-4xl font-bold">Something slipped :(</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-[var(--smoke)]">
          ShapeUp hit an unexpected error. Sorry for the inconvenience.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-md bg-[var(--tomato)] px-5 py-3 font-sans text-sm font-bold uppercase tracking-wider text-white"
        >
          Reload this view
        </button>
      </section>
    </main>
  );
}
