import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * The egress bootstrap's rollback path — issue #99.
 *
 * Starting a segment creates a Mux live stream and then asks LiveKit to
 * composite the room into it. LiveKit's transcode allowance is spent until
 * ~1 Dec 2026, so that second call fails every time, and the rollback has to
 * put the unused Mux stream back.
 *
 * It called `complete()`, which ends a live *session* and leaves the stream
 * object in place as `idle`. A stream that never received a frame has no
 * session to end, so nothing was released — and because the same rollback
 * clears `mux_stream_id`, nothing in the app could find those streams again.
 * A single debate on 2026-11-18 left two behind; they had to be deleted by
 * hand, and every segment start would have left another, because the
 * bootstrap re-runs for as long as `livekit_egress_id` is null.
 *
 * These tests pin the distinction that caused it: the rollback deletes, the
 * end-of-debate teardown completes, and neither runs when egress succeeds.
 */

const query = vi.fn();
const requireModeratorFromRequest = vi.fn();
const startSegment = vi.fn();
const applySegmentMicPermissions = vi.fn();
const notifyDebateChanged = vi.fn();
const sweepOrphanedEgress = vi.fn();

const createMuxLiveStream = vi.fn();
const completeMuxLiveStream = vi.fn();
const deleteMuxLiveStream = vi.fn();
const startDebateEgress = vi.fn();

class FakeModeratorGateError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query }) }));
vi.mock('@/lib/auth/require-moderator', () => ({
  requireModeratorFromRequest: (req: unknown) => requireModeratorFromRequest(req),
  ModeratorGateError: FakeModeratorGateError,
}));
vi.mock('@/lib/debate/transitions', () => ({
  startSegment: (a: unknown) => startSegment(a),
  endSegment: vi.fn(),
  repeatSegment: vi.fn(),
}));
vi.mock('@/lib/debate/mic-control', () => ({
  applySegmentMicPermissions: (...a: unknown[]) => applySegmentMicPermissions(...a),
}));
vi.mock('@/lib/debate/notify', () => ({
  notifyDebateChanged: (...a: unknown[]) => notifyDebateChanged(...a),
}));
vi.mock('@/lib/debate/teardown', () => ({
  teardownDebateMedia: vi.fn(),
  sweepOrphanedEgress: () => sweepOrphanedEgress(),
}));
// The worker holds LiveKit's native bindings. Registered as a live Map so the
// route's `activeWorkers.has(...)` guard behaves, and cleared between tests.
const activeWorkers = new Map<string, unknown>();
vi.mock('@/lib/transcription/registry', () => ({ activeWorkers }));
vi.mock('@/lib/transcription/worker', () => ({
  TranscriptionWorker: class {
    async start() {}
    async stop() {}
  },
}));
vi.mock('@/lib/mux/client', () => ({
  createMuxLiveStream: () => createMuxLiveStream(),
  completeMuxLiveStream: (id: string) => completeMuxLiveStream(id),
  deleteMuxLiveStream: (id: string) => deleteMuxLiveStream(id),
}));
vi.mock('@/lib/livekit/egress-service', () => ({
  startDebateEgress: (...a: unknown[]) => startDebateEgress(...a),
}));

const { POST } = await import('./route');

const DEBATE_ID = '80110ad3-e2c5-46f5-aff9-fea260109c86';
const SEGMENT_ID = '1e259fe0-5f74-4f57-bf5e-db10083b27df';
const USER_ID = '4e6dde8f-2bd0-4054-824f-4164744165ea';
const ROOM = `ld-${DEBATE_ID}`;
const MUX_STREAM_ID = 'mux-stream-created-by-bootstrap';

/** Next 16 hands route handlers their params as a promise. */
function ctx() {
  return { params: Promise.resolve({ debateId: DEBATE_ID, segmentId: SEGMENT_ID }) };
}

function request(action: 'start' | 'end' | 'repeat' = 'start') {
  return new Request(
    `https://example.test/api/debates/${DEBATE_ID}/segments/${SEGMENT_ID}`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    },
  ) as unknown as Parameters<typeof POST>[0];
}

/**
 * Statements are matched on what they touch rather than on call order, so a
 * query added elsewhere in the route does not shift fixtures onto the wrong
 * one. `egressId` decides whether the bootstrap is reached at all.
 */
function poolResponds({ egressId = null as string | null } = {}) {
  query.mockImplementation(async (sql: string) => {
    if (/FROM\s+listening\.debate_segments\b/i.test(sql)) {
      return { rows: [{ allocated_seconds: 360 }], rowCount: 1 };
    }
    if (/SELECT\s+livekit_room_name,\s*livekit_egress_id/i.test(sql)) {
      return { rows: [{ livekit_room_name: ROOM, livekit_egress_id: egressId }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** Every UPDATE the route ran, as raw SQL. */
function statements(): string[] {
  return query.mock.calls.map(c => String(c[0]));
}

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  activeWorkers.clear();
  requireModeratorFromRequest.mockResolvedValue(USER_ID);
  startSegment.mockResolvedValue({ id: SEGMENT_ID, sequence_order: 1 });
  applySegmentMicPermissions.mockResolvedValue(undefined);
  notifyDebateChanged.mockResolvedValue(undefined);
  sweepOrphanedEgress.mockResolvedValue(undefined);
  createMuxLiveStream.mockResolvedValue({
    muxStreamId: MUX_STREAM_ID,
    muxStreamKey: 'stream-key',
    muxPlaybackId: 'playback-id',
  });
  poolResponds();
});

afterAll(() => {
  errorSpy.mockRestore();
});

describe('POST segments — egress bootstrap rollback (#99)', () => {
  it('deletes the Mux stream when egress fails, rather than completing it', async () => {
    startDebateEgress.mockRejectedValue(new Error('429 resource_exhausted'));

    const res = await POST(request(), ctx());

    expect(res.status).toBe(200);
    expect(deleteMuxLiveStream).toHaveBeenCalledWith(MUX_STREAM_ID);
    // The bug: `complete()` ends a session this stream never had, and leaves
    // the object behind as `idle`.
    expect(completeMuxLiveStream).not.toHaveBeenCalled();
  });

  it('clears the dead playback id so observers get the placeholder, not a frozen player', async () => {
    startDebateEgress.mockRejectedValue(new Error('429 resource_exhausted'));

    await POST(request(), ctx());

    const cleared = statements().find(s => /mux_playback_id\s*=\s*NULL/i.test(s));
    expect(cleared).toBeDefined();
    // Guarded, so a rollback racing a successful bootstrap cannot wipe a live one.
    expect(cleared).toMatch(/livekit_egress_id\s+IS\s+NULL/i);
  });

  it('starts the segment anyway — a debate without video is still a debate', async () => {
    startDebateEgress.mockRejectedValue(new Error('429 resource_exhausted'));

    const res = await POST(request(), ctx());

    expect(res.status).toBe(200);
    expect(startSegment).toHaveBeenCalled();
    expect(notifyDebateChanged).toHaveBeenCalledWith(DEBATE_ID, 'segment-start');
  });

  it('survives a delete that itself fails, and still clears the playback id', async () => {
    startDebateEgress.mockRejectedValue(new Error('429 resource_exhausted'));
    deleteMuxLiveStream.mockRejectedValue(new Error('Mux unreachable'));

    const res = await POST(request(), ctx());

    expect(res.status).toBe(200);
    expect(statements().some(s => /mux_playback_id\s*=\s*NULL/i.test(s))).toBe(true);
  });

  it('releases nothing when egress starts cleanly', async () => {
    startDebateEgress.mockResolvedValue('egress-123');

    const res = await POST(request(), ctx());

    expect(res.status).toBe(200);
    expect(deleteMuxLiveStream).not.toHaveBeenCalled();
    expect(completeMuxLiveStream).not.toHaveBeenCalled();
    expect(statements().some(s => /livekit_egress_id\s*=\s*\$1/i.test(s))).toBe(true);
  });

  it('does not create a second Mux stream once egress is running', async () => {
    poolResponds({ egressId: 'egress-already-running' });

    const res = await POST(request(), ctx());

    expect(res.status).toBe(200);
    expect(createMuxLiveStream).not.toHaveBeenCalled();
    expect(deleteMuxLiveStream).not.toHaveBeenCalled();
  });
});
