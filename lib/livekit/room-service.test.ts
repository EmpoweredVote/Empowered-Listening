import { describe, it, expect, vi, beforeEach } from 'vitest';

const listParticipants = vi.fn();

vi.mock('livekit-server-sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-server-sdk')>();
  return {
    ...actual,
    // Only the client is stubbed; ServerError and TrackSource stay real, so
    // the not-found test rejects with the type the SDK actually throws.
    RoomServiceClient: class {
      listParticipants = listParticipants;
    },
  };
});

vi.mock('@/lib/env', () => ({
  env: {
    LIVEKIT_URL: 'wss://test.livekit.cloud',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'test-secret',
  },
}));

import { ServerError } from 'livekit-server-sdk';
import { countParticipants } from './room-service';

const DEBATE = 'd008dcf0-4430-4537-a901-94d8719c0673';
const ROOM = `ld-${DEBATE}`;
const AFF = `${DEBATE}:aff:11111111-1111-4111-8111-111111111111`;
const NEG = `${DEBATE}:neg:22222222-2222-4222-8222-222222222222`;
const MOD = `${DEBATE}:mod:33333333-3333-4333-8333-333333333333`;
const PEOPLE = new Set([AFF, NEG, MOD]);

describe('countParticipants', () => {
  beforeEach(() => {
    listParticipants.mockReset();
  });

  it('counts the people named in the allowlist', async () => {
    listParticipants.mockResolvedValue([
      { identity: AFF },
      { identity: NEG },
      { identity: MOD },
    ]);
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(3);
  });

  it('does not count the transcription worker', async () => {
    // The worker joins every live debate's room and never leaves until
    // teardown runs — and teardown is what the abandon watcher is trying to
    // reach. Counting it would mean no room is ever empty and no debate is
    // ever ended: the feature would be inert, and self-lockingly so.
    listParticipants.mockResolvedValue([{ identity: `transcription-worker:${DEBATE}` }]);
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(0);
  });

  it('does not count the egress recorder', async () => {
    // LiveKit may or may not report recorders as hidden. An allowlist means
    // we do not have to know.
    listParticipants.mockResolvedValue([{ identity: 'EG_abc123' }]);
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(0);
  });

  it('counts the people while ignoring everything else in the room', async () => {
    listParticipants.mockResolvedValue([
      { identity: `transcription-worker:${DEBATE}` },
      { identity: MOD },
      { identity: 'EG_abc123' },
    ]);
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(1);
  });

  it('reports a room everyone has left as empty', async () => {
    listParticipants.mockResolvedValue([]);
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(0);
  });

  it('reports a room LiveKit has never heard of as empty', async () => {
    // Rooms are created on first join, so "no such room" and "nobody in the
    // room" are the same fact. Returning null here instead of 0 would stop
    // the abandon clock from ever starting on a debate nobody joined.
    listParticipants.mockRejectedValue(
      new ServerError('not_found', 'requested room does not exist', 404, 'not_found'),
    );
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBe(0);
  });

  it('reports null when LiveKit cannot be reached at all', async () => {
    // Not an empty room — an unanswerable question. The caller holds its
    // clock rather than counting this as evidence the debate is abandoned.
    listParticipants.mockRejectedValue(new Error('fetch failed'));
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBeNull();
  });

  it('reports null for a server error that is not a missing room', async () => {
    listParticipants.mockRejectedValue(
      new ServerError('internal', 'boom', 500, 'internal'),
    );
    await expect(countParticipants(ROOM, PEOPLE)).resolves.toBeNull();
  });
});

describe('countParticipants with no LiveKit credentials', () => {
  it('reports null rather than rejecting', async () => {
    // The normal state of a local checkout. `getRoomService()` throws here,
    // inside the try, so the pass must come back null — not reject, which
    // would be a rejection the watcher's per-debate catch has to absorb, and
    // not 0, which would read as an empty room and cancel live debates.
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ env: {} }));
    try {
      const { countParticipants: fresh } = await import('./room-service');
      await expect(fresh(ROOM, PEOPLE)).resolves.toBeNull();
    } finally {
      vi.doUnmock('@/lib/env');
      vi.resetModules();
    }
  });
});
