import { describe, it, expect } from 'vitest';
import { ABANDON_GRACE_MS, nextEmptySince, shouldEndAbandoned } from './abandon-rules';

const T0 = 1_700_000_000_000;

describe('ABANDON_GRACE_MS', () => {
  it('is two minutes — long enough to outlast a page refresh', () => {
    expect(ABANDON_GRACE_MS).toBe(2 * 60_000);
  });
});

describe('nextEmptySince', () => {
  it('starts the clock when an occupied room first reads empty', () => {
    expect(nextEmptySince(null, 0, T0)).toBe(T0);
  });

  it('keeps the original timestamp while the room stays empty', () => {
    expect(nextEmptySince(T0, 0, T0 + 30_000)).toBe(T0);
  });

  it('clears the clock as soon as anyone is in the room', () => {
    expect(nextEmptySince(T0, 1, T0 + 30_000)).toBeNull();
  });

  it('preserves a running clock when LiveKit could not be asked', () => {
    // An API failure is not evidence of an empty room. Treating it as one
    // would cancel every live debate during a LiveKit outage.
    expect(nextEmptySince(T0, null, T0 + 30_000)).toBe(T0);
  });

  it('does not start a clock from a failed lookup', () => {
    expect(nextEmptySince(null, null, T0)).toBeNull();
  });
});

describe('shouldEndAbandoned', () => {
  const past = T0 - ABANDON_GRACE_MS - 1;

  it('ends a live debate whose room has been empty past the grace window', () => {
    expect(shouldEndAbandoned({ status: 'live', emptySinceMs: past, nowMs: T0 })).toBe(true);
  });

  it('waits while the room is still inside the grace window', () => {
    expect(
      shouldEndAbandoned({ status: 'live', emptySinceMs: T0 - 1_000, nowMs: T0 }),
    ).toBe(false);
  });

  it('leaves an occupied debate alone', () => {
    expect(shouldEndAbandoned({ status: 'live', emptySinceMs: null, nowMs: T0 })).toBe(false);
  });

  it('never cancels a debate nobody has arrived at yet', () => {
    // A scheduled debate has an empty room by definition.
    expect(shouldEndAbandoned({ status: 'scheduled', emptySinceMs: past, nowMs: T0 })).toBe(false);
  });

  it.each(['completed', 'cancelled', null] as const)(
    'leaves a %s debate alone',
    status => {
      expect(shouldEndAbandoned({ status, emptySinceMs: past, nowMs: T0 })).toBe(false);
    },
  );

  it('treats the exact grace boundary as reached', () => {
    expect(
      shouldEndAbandoned({ status: 'live', emptySinceMs: T0 - ABANDON_GRACE_MS, nowMs: T0 }),
    ).toBe(true);
  });
});
