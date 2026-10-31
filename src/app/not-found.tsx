import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--biscuit)] px-6 text-[var(--ink)]">
      <section className="max-w-md rounded-md border border-[rgba(42,32,26,0.14)] bg-[var(--cream)] p-6 text-center">
        <h1 className="font-sans text-4xl font-bold">Page not found :(</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-[var(--smoke)]">
          This page is not part of the current ShapeUp app. Sorry for the inconvenience.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md bg-[var(--tomato)] px-5 py-3 font-sans text-sm font-bold uppercase tracking-wider text-white"
        >
          Back home
        </Link>
      </section>
    </main>
  );
}
