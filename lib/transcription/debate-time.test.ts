/// <reference types="vitest/globals" />
import { computeDebateTimeMmss } from './debate-time';

describe('computeDebateTimeMmss', () => {
  const T = new Date('2026-01-01T10:00:00.000Z');

  it('returns 00:00 when spokenAt equals actualStart', () => {
    expect(computeDebateTimeMmss(T, T)).toBe('00:00');
  });

  it('returns 00:01 after 1 second', () => {
    expect(computeDebateTimeMmss(T, new Date(T.getTime() + 1000))).toBe('00:01');
  });

  it('returns 01:30 after 90 seconds', () => {
    expect(computeDebateTimeMmss(T, new Date(T.getTime() + 90_000))).toBe('01:30');
  });

  it('returns 02:30 after 150 seconds', () => {
    expect(computeDebateTimeMmss(T, new Date(T.getTime() + 150_000))).toBe('02:30');
  });

  it('returns 60:00 after 3600 seconds', () => {
    expect(computeDebateTimeMmss(T, new Date(T.getTime() + 3_600_000))).toBe('60:00');
  });

  it('clamps to 00:00 when spokenAt is before actualStart (clock skew)', () => {
    expect(computeDebateTimeMmss(T, new Date(T.getTime() - 5000))).toBe('00:00');
  });
});
