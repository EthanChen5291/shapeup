import { describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()) }));
vi.mock('@sentry/nextjs', () => sentry);

import { traced } from './trace';

describe('traced', () => {
  it('runs the work in its own transaction tagged with the job, and returns its result', async () => {
    const result = await traced('facelift.build', { jobId: 'job_1', mode: 'edit', skipped: undefined }, async () => 42);
    expect(result).toBe(42);
    expect(sentry.startSpan).toHaveBeenCalledWith(
      { name: 'facelift.build', op: 'facelift.build', attributes: { jobId: 'job_1', mode: 'edit' }, forceTransaction: true },
      expect.any(Function),
    );
  });

  it('passes failures through untouched', async () => {
    await expect(traced('facelift.build', {}, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
