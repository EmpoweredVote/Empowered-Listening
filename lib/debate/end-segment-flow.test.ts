import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const endSegment = vi.fn();
const teardownDebateMedia = vi.fn();
const notifyDebateChanged = vi.fn();
const setMicPermission = vi.fn();

// Wrapped in arrows, not passed by reference: a vi.mock factory is hoisted
// above these declarations, so anything it evaluates eagerly reads an
// uninitialised binding.
vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
  pool: { query: (...args: unknown[]) => query(...args) },
}));
vi.mock('@/lib/debate/transitions', () => ({
  endSegment: (args: unknown) => endSegment(args),
}));
vi.mock('@/lib/debate/teardown', () => ({
  teardownDebateMedia: (id: string) => teardownDebateMedia(id),
}));
vi.mock('@/lib/debate/notify', () => ({
  notifyDebateChanged: (id: string, reason: string) => notifyDebateChanged(id, reason),
}));
vi.mock('@/lib/livekit/room-service', () => ({
  setMicPermission: (room: string, identity: string, canPublish: boolean) =>
    setMicPermission(room, identity, canPublish),
}));

import { performSegmentEnd, revokeSpeakerMics } from './end-segment-flow';

const DEBATE = 'd008dcf0-4430-4537-a901-94d8719c0673';
const SEGMENT = '11111111-1111-4111-8111-111111111111';
const MODERATOR = '33333333-3333-4333-8333-333333333333';
const ROOM = `ld-${DEBATE}`;
const AFF = `${DEBATE}:aff:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const NEG = `${DEBATE}:neg:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const SEGMENT_ROW = { id: SEGMENT, status: 'completed' };

/**
 * The three queries performSegmentEnd issues, in order: the debate's status,
 * then the two speakers, then the room name.
 */
function answerQueries(debateStatus: string, opts: { room?: string | null } = {}) {
  const room = opts.room === undefined ? ROOM : opts.room;
  query
    .mockResolvedValueOnce({ rows: [{ status: debateStatus }] })
    .mockResolvedValueOnce({
      rows: [
        { role: 'affirmative', livekit_identity: AFF },
        { role: 'negative', livekit_identity: NEG },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ livekit_room_name: room }] });
}

beforeEach(() => {
  query.mockReset();
  endSegment.mockReset().mockResolvedValue(SEGMENT_ROW);
  teardownDebateMedia.mockReset().mockResolvedValue({});
  notifyDebateChanged.mockReset().mockResolvedValue(undefined);
  setMicPermission.mockReset().mockResolvedValue(undefined);
});

describe('performSegmentEnd', () => {
  it('releases the media once the last segment has completed the debate', async () => {
    // end_segment flips the debate to 'completed' when the segment it just
    // ended was the last one. That is the moment the egress, the Mux stream
    // and the transcription worker stop being needed.
    answerQueries('completed');

    const result = await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(result).toBe(SEGMENT_ROW);
    expect(teardownDebateMedia).toHaveBeenCalledWith(DEBATE);
  });

  it('leaves the media alone between segments', async () => {
    // A debate still reading 'live' has more segments to run. Tearing down
    // here would kill the egress and the transcription worker mid-debate.
    answerQueries('live');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(teardownDebateMedia).not.toHaveBeenCalled();
  });

  it('goes through teardownDebateMedia rather than releasing the three itself', async () => {
    // The rule this pins is CLAUDE.md's: teardownDebateMedia is the only
    // correct way to release egress, Mux and the worker, and the way that rule
    // gets broken is a second ending growing its own copy of the sequence.
    // This path grew one once, which is what the test exists to catch.
    answerQueries('completed');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    const sql = query.mock.calls.map(c => String(c[0])).join('\n');
    expect(sql).not.toMatch(/livekit_egress_id\s*=\s*NULL/i);
    expect(sql).not.toMatch(/mux_stream_id/i);
  });

  it('takes both speakers off the air', async () => {
    // No segment is active after an end, so neither speaker should hold a live
    // microphone while the moderator decides what happens next.
    answerQueries('live');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(setMicPermission).toHaveBeenCalledWith(ROOM, AFF, false);
    expect(setMicPermission).toHaveBeenCalledWith(ROOM, NEG, false);
  });

  it('tells every connected client the segment is over', async () => {
    // The whole point of server-side expiry: a segment that ends with no
    // moderator tab open must still reach the people watching it.
    answerQueries('live');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(notifyDebateChanged).toHaveBeenCalledWith(DEBATE, 'segment-end');
  });

  it('notifies last, after the media is released and the mics are down', async () => {
    // Clients answer the notification by re-reading the snapshot. Sent first,
    // they would read a state that is still changing underneath them.
    answerQueries('completed');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(notifyDebateChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      teardownDebateMedia.mock.invocationCallOrder[0],
    );
    expect(notifyDebateChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      setMicPermission.mock.invocationCallOrder[0],
    );
  });

  it('ends the segment before anything else happens', async () => {
    answerQueries('completed');

    await performSegmentEnd({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });

    expect(endSegment).toHaveBeenCalledWith({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });
    expect(endSegment.mock.invocationCallOrder[0]).toBeLessThan(
      teardownDebateMedia.mock.invocationCallOrder[0],
    );
  });
});

describe('revokeSpeakerMics', () => {
  it('does nothing when the debate has no LiveKit room', async () => {
    // livekit_room_name is nullable. A null handed to setMicPermission would
    // be an error thrown out of a path whose job is only to be safe.
    query
      .mockResolvedValueOnce({ rows: [{ role: 'affirmative', livekit_identity: AFF }] })
      .mockResolvedValueOnce({ rows: [{ livekit_room_name: null }] });

    await revokeSpeakerMics(DEBATE);

    expect(setMicPermission).not.toHaveBeenCalled();
  });

  it('does nothing when the debate row is gone', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await revokeSpeakerMics(DEBATE);

    expect(setMicPermission).not.toHaveBeenCalled();
  });

  it('skips a speaker who holds no LiveKit seat', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          { role: 'affirmative', livekit_identity: AFF },
          { role: 'negative', livekit_identity: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ livekit_room_name: ROOM }] });

    await revokeSpeakerMics(DEBATE);

    expect(setMicPermission).toHaveBeenCalledTimes(1);
    expect(setMicPermission).toHaveBeenCalledWith(ROOM, AFF, false);
  });

  it('still mutes the other speaker when one revoke fails', async () => {
    // allSettled, not all: a seat LiveKit no longer knows about must not leave
    // the other speaker's microphone live.
    query
      .mockResolvedValueOnce({
        rows: [
          { role: 'affirmative', livekit_identity: AFF },
          { role: 'negative', livekit_identity: NEG },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ livekit_room_name: ROOM }] });
    setMicPermission.mockRejectedValueOnce(new Error('participant does not exist'));

    await expect(revokeSpeakerMics(DEBATE)).resolves.toBeUndefined();
    expect(setMicPermission).toHaveBeenCalledTimes(2);
  });
});
