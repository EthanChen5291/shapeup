import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = { setTag: vi.fn(), setContext: vi.fn() };
const sentry = vi.hoisted(() => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@sentry/nextjs', () => sentry);

import { formatLogLine, logEvent } from './log';

afterEach(() => {
  vi.restoreAllMocks();
  sentry.withScope.mockReset();
  sentry.captureException.mockReset();
  sentry.captureMessage.mockReset();
  scope.setTag.mockReset();
  sentry.logger.info.mockReset();
  sentry.logger.warn.mockReset();
  sentry.logger.error.mockReset();
});

describe('formatLogLine', () => {
  it('is one JSON object with svc, event, ts and the fields, minus undefined ones', () => {
    const line = formatLogLine('build.done', { jobId: 'job_1', elapsedMs: 9100, gpuS: undefined }, 1700000000000);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ svc: 'vercel', event: 'build.done', ts: 1700000000000, jobId: 'job_1', elapsedMs: 9100 });
  });
});

describe('logEvent', () => {
  it('logs info to stdout and never reports it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent('build.accepted', { jobId: 'job_1' });
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ event: 'build.accepted', jobId: 'job_1' });
    expect(sentry.withScope).not.toHaveBeenCalled();
    expect(sentry.logger.info).toHaveBeenCalledWith('build.accepted', { svc: 'vercel', jobId: 'job_1' });
  });

  it('logs warnings to stderr without reporting them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logEvent('build.failed', { jobId: 'job_1' }, { level: 'warn' });
    expect(warn).toHaveBeenCalledOnce();
    expect(sentry.withScope).not.toHaveBeenCalled();
  });

  it('reports errors to Sentry tagged with the job id, and logs the message', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    sentry.withScope.mockImplementation((fn: (s: typeof scope) => void) => fn(scope));
    const boom = new Error('worker unreachable');
    logEvent('build.crashed', { jobId: 'job_9', mode: 'edit' }, { level: 'error', error: boom });
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ event: 'build.crashed', jobId: 'job_9', error: 'worker unreachable' });
    expect(scope.setTag).toHaveBeenCalledWith('job_id', 'job_9');
    expect(sentry.captureException).toHaveBeenCalledWith(boom);
    expect(sentry.logger.error).toHaveBeenCalledWith('build.crashed', { svc: 'vercel', jobId: 'job_9', mode: 'edit', error: 'worker unreachable' });
  });

  it('reports a non-Error failure as a message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sentry.withScope.mockImplementation((fn: (s: typeof scope) => void) => fn(scope));
    logEvent('hold.release_failed', { jobId: 'job_2' }, { level: 'error', error: 'timeout' });
    expect(sentry.captureMessage).toHaveBeenCalledWith('hold.release_failed: timeout', 'error');
  });
});
