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

const ROOM = 'ld-d008dcf0-4430-4537-a901-94d8719c0673';

describe('countParticipants', () => {
  beforeEach(() => {
    listParticipants.mockReset();
  });

  it('returns the number of participants in the room', async () => {
    listParticipants.mockResolvedValue([
      { identity: 'aff' },
      { identity: 'neg' },
      { identity: 'mod' },
    ]);
    await expect(countParticipants(ROOM)).resolves.toBe(3);
  });

  it('reports a room everyone has left as empty', async () => {
    listParticipants.mockResolvedValue([]);
    await expect(countParticipants(ROOM)).resolves.toBe(0);
  });

  it('reports a room LiveKit has never heard of as empty', async () => {
    // Rooms are created on first join, so "no such room" and "nobody in the
    // room" are the same fact. Returning null here instead of 0 would stop
    // the abandon clock from ever starting on a debate nobody joined.
    listParticipants.mockRejectedValue(
      new ServerError('not_found', 'requested room does not exist', 404, 'not_found'),
    );
    await expect(countParticipants(ROOM)).resolves.toBe(0);
  });

  it('reports null when LiveKit cannot be reached at all', async () => {
    // Not an empty room — an unanswerable question. The caller holds its
    // clock rather than counting this as evidence the debate is abandoned.
    listParticipants.mockRejectedValue(new Error('fetch failed'));
    await expect(countParticipants(ROOM)).resolves.toBeNull();
  });

  it('reports null for a server error that is not a missing room', async () => {
    listParticipants.mockRejectedValue(
      new ServerError('internal', 'boom', 500, 'internal'),
    );
    await expect(countParticipants(ROOM)).resolves.toBeNull();
  });
});
