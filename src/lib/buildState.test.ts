import { describe, expect, test } from 'vitest';
import {
  BUILD_STALE_MS,
  STALE_BUILD_ERROR,
  resolveBuildState,
} from './buildState';

describe('resolveBuildState', () => {
  const NOW = 1_700_000_000_000;

  test('null/undefined → idle', () => {
    expect(resolveBuildState(null, NOW)).toBe('idle');
    expect(resolveBuildState(undefined, NOW)).toBe('idle');
  });

  test('missing buildStatus with splatS3Key → ready (legacy projects)', () => {
    expect(resolveBuildState({ splatS3Key: 'splats/abc.ply' }, NOW)).toBe('ready');
  });

  test('missing both buildStatus and splatS3Key → idle', () => {
    expect(resolveBuildState({}, NOW)).toBe('idle');
  });

  test('buildStatus "ready" → ready', () => {
    expect(resolveBuildState({ buildStatus: 'ready', splatS3Key: 'splats/abc.ply' }, NOW)).toBe('ready');
    // splatS3Key takes priority, so test without it too
    expect(resolveBuildState({ buildStatus: 'ready' }, NOW)).toBe('ready');
  });

  test('buildStatus "failed" → failed', () => {
    expect(resolveBuildState({ buildStatus: 'failed' }, NOW)).toBe('failed');
  });

  test('buildStatus "building" within time window → building', () => {
    const startedAt = NOW - BUILD_STALE_MS + 1000; // 1s before stale threshold
    expect(resolveBuildState({ buildStatus: 'building', buildStartedAt: startedAt }, NOW)).toBe('building');
  });

  test('buildStatus "building" older than BUILD_STALE_MS → failed (stale)', () => {
    const startedAt = NOW - BUILD_STALE_MS - 1000; // 1s past stale threshold
    expect(resolveBuildState({ buildStatus: 'building', buildStartedAt: startedAt }, NOW)).toBe('failed');
  });

  test('buildStatus "building" with no startedAt → building (no stale check)', () => {
    expect(resolveBuildState({ buildStatus: 'building' }, NOW)).toBe('building');
  });

  test('STALE_BUILD_ERROR is a non-empty string', () => {
    expect(typeof STALE_BUILD_ERROR).toBe('string');
    expect(STALE_BUILD_ERROR.length).toBeGreaterThan(0);
  });
});
