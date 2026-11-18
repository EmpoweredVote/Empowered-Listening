import { describe, it, expect } from 'vitest';
import {
  debateIdFromRoomName,
  shouldStopEgress,
  SWEEP_GRACE_MS,
} from './teardown-rules';

const UUID = 'd72df79a-2bf5-400c-b134-fdb50b8d454a';

describe('debateIdFromRoomName', () => {
  it('recovers the debate id from a room this app minted', () => {
    expect(debateIdFromRoomName(`ld-${UUID}`)).toBe(UUID);
  });

  it('lowercases the recovered id so it matches the stored uuid', () => {
    expect(debateIdFromRoomName(`ld-${UUID.toUpperCase()}`)).toBe(UUID);
  });

  it.each([
    ['no prefix', UUID],
    ['a different prefix', `cs-${UUID}`],
    ['prefix but not a uuid', 'ld-not-a-uuid'],
    ['prefix and nothing else', 'ld-'],
    ['empty', ''],
  ])('returns null for %s', (_label, roomName) => {
    expect(debateIdFromRoomName(roomName)).toBeNull();
  });

  it('does not claim a room that merely contains a debate id', () => {
    // Guards the sweep against stopping another app's egress in a shared
    // LiveKit project: only our exact `ld-<uuid>` shape is ours to stop.
    expect(debateIdFromRoomName(`other-ld-${UUID}`)).toBeNull();
  });
});

describe('shouldStopEgress', () => {
  const OLD = SWEEP_GRACE_MS + 1;

  it('never stops an egress for a live debate, however old', () => {
    expect(shouldStopEgress({ status: 'live', ageMs: 6 * 60 * 60_000 })).toBe(false);
  });

  it.each(['completed', 'cancelled', 'scheduled'] as const)(
    'stops an aged egress for a %s debate',
    status => {
      expect(shouldStopEgress({ status, ageMs: OLD })).toBe(true);
    },
  );

  it('stops an aged egress whose debate row no longer exists', () => {
    // The orphan case: deleting a debate left its egress running.
    expect(shouldStopEgress({ status: null, ageMs: OLD })).toBe(true);
  });

  it('spares a young egress whose debate has not flipped to live yet', () => {
    // Bootstrap writes status and starts egress in separate transactions.
    expect(shouldStopEgress({ status: 'scheduled', ageMs: 1_000 })).toBe(false);
  });

  it('spares an egress exactly one millisecond short of the grace period', () => {
    expect(shouldStopEgress({ status: 'completed', ageMs: SWEEP_GRACE_MS - 1 })).toBe(false);
  });

  it('stops an egress exactly at the grace period', () => {
    expect(shouldStopEgress({ status: 'completed', ageMs: SWEEP_GRACE_MS })).toBe(true);
  });
});
