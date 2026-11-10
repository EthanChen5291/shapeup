import { describe, expect, it } from 'vitest';
import { buildLogEnvelope, envelopeUrl } from './sentryLog';

describe('envelopeUrl', () => {
  it('turns a DSN into the ingest endpoint with the public key', () => {
    expect(envelopeUrl('https://abc123@o45.ingest.us.sentry.io/789')).toBe(
      'https://o45.ingest.us.sentry.io/api/789/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=shapeup-convex%2F1.0',
    );
  });
  it('rejects anything that is not a DSN', () => {
    expect(envelopeUrl('not a dsn')).toBeNull();
    expect(envelopeUrl('https://o45.ingest.us.sentry.io/789')).toBeNull(); // no key
  });
});

describe('buildLogEnvelope', () => {
  it('writes the three lines Sentry expects, with typed attributes and no nulls', () => {
    const body = buildLogEnvelope('warn', 'build.health', { completed: 18, failureRate: 0.14, p95Ms: null, svc: 'convex', ok: false }, 'production', 1_700_000_000_500, 'f'.repeat(32));
    const [header, itemHeader, payload] = body.split('\n').map((l) => JSON.parse(l));
    expect(header.sdk.name).toBe('shapeup.convex');
    expect(itemHeader).toEqual({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' });
    const item = payload.items[0];
    expect(payload.version).toBe(2);
    expect(item).toMatchObject({ timestamp: 1_700_000_000.5, level: 'warn', body: 'build.health', severity_number: 13, trace_id: 'f'.repeat(32) });
    expect(item.attributes).toEqual({
      completed: { value: 18, type: 'integer' },
      failureRate: { value: 0.14, type: 'double' },
      svc: { value: 'convex', type: 'string' },
      ok: { value: false, type: 'boolean' },
      'sentry.environment': { value: 'production', type: 'string' },
    });
  });
});
