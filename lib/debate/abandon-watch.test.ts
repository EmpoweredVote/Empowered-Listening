import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
const countParticipants = vi.fn();
const endDebate = vi.fn();

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
  pool: { query: (...args: unknown[]) => query(...args) },
}));
vi.mock('@/lib/livekit/room-service', () => ({
  countParticipants: (room: string) => countParticipants(room),
}));
vi.mock('@/lib/debate/end-debate', () => ({
  endDebate: (id: string, outcome: string) => endDebate(id, outcome),
}));

import { ABANDON_GRACE_MS } from './abandon-rules';
import {
  pendingAbandonClocks,
  stopAbandonWatch,
  sweepAbandonedDebates,
} from './abandon-watch';

const DEBATE = 'd008dcf0-4430-4537-a901-94d8719c0673';
const ROOM = `ld-${DEBATE}`;
const T0 = 1_700_000_000_000;

/** The watcher's query answers with one live debate. */
function oneLiveDebate() {
  query.mockResolvedValue({ rows: [{ id: DEBATE, status: 'live', livekit_room_name: ROOM }] });
}

beforeEach(() => {
  query.mockReset();
  countParticipants.mockReset();
  endDebate.mockReset().mockResolvedValue({ status: 'cancelled', teardown: {} });
  stopAbandonWatch();
});

afterEach(() => {
  stopAbandonWatch();
});

describe('sweepAbandonedDebates', () => {
  it('ends a live debate after two continuous minutes of an empty room', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(0);

    const first = await sweepAbandonedDebates(T0);
    expect(first).toEqual({ checked: 1, ended: [] });

    const later = await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS);
    expect(later).toEqual({ checked: 1, ended: [DEBATE] });
    expect(endDebate).toHaveBeenCalledTimes(1);
  });

  it('does not end one that is still inside the grace window', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(0);

    await sweepAbandonedDebates(T0);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS - 1);

    expect(endDebate).not.toHaveBeenCalled();
  });

  it('does not end one somebody rejoined before the window elapsed', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValueOnce(0);
    await sweepAbandonedDebates(T0);

    // The moderator's tab comes back — a refresh, or wifi returning.
    countParticipants.mockResolvedValueOnce(1);
    await sweepAbandonedDebates(T0 + 60_000);

    // And leaves again. The clock restarts; it does not resume.
    countParticipants.mockResolvedValue(0);
    await sweepAbandonedDebates(T0 + 90_000);
    await sweepAbandonedDebates(T0 + 90_000 + ABANDON_GRACE_MS - 1);

    expect(endDebate).not.toHaveBeenCalled();
  });

  it('ends it as cancelled, never completed', async () => {
    // A debate that reached the end of segment 7 is already `completed` and
    // torn down there. Anything still live did not finish.
    oneLiveDebate();
    countParticipants.mockResolvedValue(0);

    await sweepAbandonedDebates(T0);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS);

    expect(endDebate).toHaveBeenCalledWith(DEBATE, 'cancelled');
  });

  it('keeps waiting rather than ending when LiveKit cannot be reached', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValueOnce(0);
    await sweepAbandonedDebates(T0);

    // An outage lasting longer than the grace window must not cancel the
    // debate: an unanswerable question is not an empty room.
    countParticipants.mockResolvedValue(null);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS * 3);

    expect(endDebate).not.toHaveBeenCalled();
  });

  it('never starts a clock from a failed lookup alone', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(null);

    await sweepAbandonedDebates(T0);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS * 3);

    expect(endDebate).not.toHaveBeenCalled();
    expect(pendingAbandonClocks()).toBe(0);
  });

  it('runs one pass at a time when a tick outlasts the interval', async () => {
    oneLiveDebate();
    let release: (n: number) => void = () => {};
    countParticipants.mockReturnValue(new Promise<number>(res => { release = res; }));

    const inFlight = sweepAbandonedDebates(T0);
    // The interval fires again before the first pass has answered.
    const overlapping = await sweepAbandonedDebates(T0 + 30_000);

    expect(overlapping).toEqual({ checked: 0, ended: [] });
    expect(countParticipants).toHaveBeenCalledTimes(1);

    release(0);
    await inFlight;
  });

  it('forgets the clock for a debate that is no longer live', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(0);
    await sweepAbandonedDebates(T0);
    expect(pendingAbandonClocks()).toBe(1);

    // The moderator ended it by hand; it drops out of the live query.
    query.mockResolvedValue({ rows: [] });
    await sweepAbandonedDebates(T0 + 30_000);

    expect(pendingAbandonClocks()).toBe(0);
  });

  it('forgets the clock for a debate it has just ended', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(0);
    await sweepAbandonedDebates(T0);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS);

    expect(pendingAbandonClocks()).toBe(0);
  });

  it('survives a boot with no LiveKit credentials', async () => {
    // getRoomService() throws when they are unset, which is the normal state
    // in a local checkout. The pass must resolve, not reject, or the interval
    // dies on its first tick.
    oneLiveDebate();
    countParticipants.mockRejectedValue(new Error('LiveKit credentials are not configured'));

    await expect(sweepAbandonedDebates(T0)).resolves.toEqual({ checked: 1, ended: [] });
    expect(endDebate).not.toHaveBeenCalled();
  });

  it('keeps going when one debate fails', async () => {
    const OTHER = 'aaaaaaaa-0000-4000-8000-000000000000';
    query.mockResolvedValue({
      rows: [
        { id: DEBATE, status: 'live', livekit_room_name: ROOM },
        { id: OTHER, status: 'live', livekit_room_name: `ld-${OTHER}` },
      ],
    });
    countParticipants
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(0);

    await sweepAbandonedDebates(T0);
    await sweepAbandonedDebates(T0 + ABANDON_GRACE_MS);

    expect(endDebate).toHaveBeenCalledWith(OTHER, 'cancelled');
    expect(endDebate).not.toHaveBeenCalledWith(DEBATE, 'cancelled');
  });

  it('resolves rather than throwing when the database is unreachable', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    await expect(sweepAbandonedDebates(T0)).resolves.toEqual({ checked: 0, ended: [] });
  });

  it('asks only for live debates, never scanning the table', async () => {
    oneLiveDebate();
    countParticipants.mockResolvedValue(1);
    await sweepAbandonedDebates(T0);

    expect(String(query.mock.calls[0][0])).toContain("status = 'live'");
  });
});
