/// <reference types="vitest/globals" />
import { expiryTimestamp } from './expiry-time';

const END_TIME = '2026-11-16T12:00:00.000Z';
const END_MS = Date.parse(END_TIME);

describe('expiryTimestamp', () => {
  it('adds the speaker bonus pool to end_time', () => {
    expect(expiryTimestamp(END_TIME, 60, true)).toBe(END_MS + 60_000);
  });

  it('expires at end_time exactly when the segment has no speaker', () => {
    // CX and moderator-run segments have no pool to draw on.
    expect(expiryTimestamp(END_TIME, 60, false)).toBe(END_MS);
  });

  it('expires at end_time when the pool is already spent', () => {
    expect(expiryTimestamp(END_TIME, 0, true)).toBe(END_MS);
  });

  it('uses the remaining pool, not the full 60s', () => {
    // After the bonus fix, a speaker who already burned 45s has 15s left.
    expect(expiryTimestamp(END_TIME, 15, true)).toBe(END_MS + 15_000);
  });

  it('never schedules earlier than end_time on a negative pool', () => {
    expect(expiryTimestamp(END_TIME, -30, true)).toBe(END_MS);
  });

  it('returns NaN for an unparseable end_time so the caller can bail', () => {
    expect(expiryTimestamp('not-a-date', 60, true)).toBeNaN();
  });
});
