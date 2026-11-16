import { describe, it, expect } from 'vitest';
import { isDebateJoinable, DEBATE_JOINABLE_STATUSES } from './joinable';

describe('isDebateJoinable', () => {
  it('lets a speaker join before the debate starts', () => {
    expect(isDebateJoinable('scheduled')).toBe(true);
  });

  it('lets a speaker join while the debate is running', () => {
    expect(isDebateJoinable('live')).toBe(true);
  });

  it('refuses a debate that has finished', () => {
    expect(isDebateJoinable('completed')).toBe(false);
  });

  it('refuses a debate that was called off', () => {
    expect(isDebateJoinable('cancelled')).toBe(false);
  });

  it('refuses an unrecognised status rather than defaulting open', () => {
    expect(isDebateJoinable('')).toBe(false);
    expect(isDebateJoinable('LIVE')).toBe(false);
    expect(isDebateJoinable('archived')).toBe(false);
  });

  it('covers exactly the two statuses the SQL re-checks', () => {
    // The claiming UPDATE repeats these as SQL literals.  If this list changes,
    // that statement has to change with it.
    expect([...DEBATE_JOINABLE_STATUSES]).toEqual(['scheduled', 'live']);
  });
});
