import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
const performSegmentEnd = vi.fn();

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
  pool: { query: (...args: unknown[]) => query(...args) },
}));
vi.mock('@/lib/debate/end-segment-flow', () => ({
  performSegmentEnd: (args: unknown) => performSegmentEnd(args),
}));

import {
  EXPIRY_MAX_ATTEMPTS,
  EXPIRY_RETRY_MS,
  shouldRunSegmentExpiry,
  cancelSegmentExpiry,
  pendingExpiryCount,
  rescheduleActiveSegments,
  scheduleSegmentExpiry,
} from './expiry-registry';

const DEBATE = 'd008dcf0-4430-4537-a901-94d8719c0673';
const SEGMENT = '11111111-1111-4111-8111-111111111111';
const SPEAKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MODERATOR = '33333333-3333-4333-8333-333333333333';
const NOW = 1_700_000_000_000;

/** The row scheduleSegmentExpiry reads, with the fields a test cares about. */
function segmentRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    rows: [{
      end_time: new Date(NOW + 60_000).toISOString(),
      speaker_id: SPEAKER,
      status: 'active',
      paused_remaining_seconds: null,
      bonus_time_seconds: 30,
      ...over,
    }],
  };
}

/** The row expireSegment re-reads when the timer fires. */
function fireRow(over: Partial<Record<string, unknown>> = {}) {
  return { rows: [{ status: 'active', moderator_user_id: MODERATOR, ...over }] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  query.mockReset();
  performSegmentEnd.mockReset().mockResolvedValue({ id: SEGMENT });
  cancelSegmentExpiry(SEGMENT);
});

afterEach(() => {
  cancelSegmentExpiry(SEGMENT);
  vi.useRealTimers();
});

describe('scheduleSegmentExpiry', () => {
  it('arms a timer for an active segment', async () => {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(1);
  });

  it('fires at end_time plus what is left of the bonus pool', async () => {
    // A speaker whose allocated time runs out keeps talking on bonus until
    // that is gone too, so the deadline is 60s + 30s here.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());

    await vi.advanceTimersByTimeAsync(89_999);
    expect(performSegmentEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(performSegmentEnd).toHaveBeenCalledOnce();
  });

  it('fires at end_time exactly for a segment with no speaker', async () => {
    // CX and moderator-run segments have no pool to draw on.
    query.mockResolvedValueOnce(segmentRow({ speaker_id: null, bonus_time_seconds: 0 }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());

    await vi.advanceTimersByTimeAsync(60_000);
    expect(performSegmentEnd).toHaveBeenCalledOnce();
  });

  it('arms nothing for a segment that is not active', async () => {
    query.mockResolvedValueOnce(segmentRow({ status: 'upcoming' }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('arms nothing for a segment paused for prep', async () => {
    // During prep end_time is not a live deadline. A timer left running here
    // would end the segment while a speaker is still preparing.
    query.mockResolvedValueOnce(segmentRow({ paused_remaining_seconds: 120 }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('arms nothing when the segment has no end_time', async () => {
    query.mockResolvedValueOnce(segmentRow({ end_time: null }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('arms nothing when the segment row is gone', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('arms nothing when end_time cannot be parsed', async () => {
    query.mockResolvedValueOnce(segmentRow({ end_time: 'not-a-date' }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('fires immediately when the deadline has already passed', async () => {
    // A process that was down past the deadline must not schedule into the
    // past, which setTimeout would treat as "now" anyway — this pins it.
    query.mockResolvedValueOnce(segmentRow({
      end_time: new Date(NOW - 600_000).toISOString(),
      bonus_time_seconds: 0,
    }));
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());

    await vi.advanceTimersByTimeAsync(0);
    expect(performSegmentEnd).toHaveBeenCalledOnce();
  });

  it('replaces a pending timer rather than stacking a second one', async () => {
    // Every path that changes end_time re-arms: repeat, end of prep, restart.
    // Two live timers on one segment would end it twice.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);

    expect(pendingExpiryCount()).toBe(1);

    query.mockResolvedValue(fireRow());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(performSegmentEnd).toHaveBeenCalledOnce();
  });

  it('forgets the segment once its timer has fired', async () => {
    // This map lives in a process that runs for weeks; an entry per segment
    // ever scheduled is a leak.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());

    await vi.advanceTimersByTimeAsync(90_000);
    expect(pendingExpiryCount()).toBe(0);
  });
});

describe('cancelSegmentExpiry', () => {
  it('drops a pending timer so it never fires', async () => {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);

    cancelSegmentExpiry(SEGMENT);
    expect(pendingExpiryCount()).toBe(0);

    query.mockResolvedValue(fireRow());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });

  it('is safe to call when nothing is pending', () => {
    expect(() => cancelSegmentExpiry(SEGMENT)).not.toThrow();
  });
});

describe('when the timer fires', () => {
  async function armAndFire(fire: ReturnType<typeof fireRow> | { rows: [] }) {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fire);
    await vi.advanceTimersByTimeAsync(90_000);
  }

  it('ends the segment as the debate moderator', async () => {
    // end_segment checks that the caller is the moderator, so the server acts
    // for them rather than bypassing the check.
    await armAndFire(fireRow());
    expect(performSegmentEnd).toHaveBeenCalledWith({
      debateId: DEBATE, segmentId: SEGMENT, moderatorUserId: MODERATOR,
    });
  });

  it('does nothing if the moderator already ended the segment', async () => {
    // The state is re-read rather than trusted from when the timer was set.
    await armAndFire(fireRow({ status: 'completed' }));
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });

  it('does nothing if the segment has gone', async () => {
    await armAndFire({ rows: [] });
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });

  it('bails rather than throwing when the debate has no moderator', async () => {
    await armAndFire(fireRow({ moderator_user_id: null }));
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });

  it('absorbs a failure instead of taking the process down', async () => {
    // An unhandled rejection out of a bare setTimeout callback is fatal in
    // Node. The moderator's End button is still there; the process must be.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());
    performSegmentEnd.mockRejectedValueOnce(new Error('livekit unreachable'));

    await expect(vi.advanceTimersByTimeAsync(90_000)).resolves.not.toThrow();
    expect(performSegmentEnd).toHaveBeenCalledOnce();
  });

  it('absorbs a database failure on the re-read', async () => {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockRejectedValue(new Error('connection terminated'));

    await expect(vi.advanceTimersByTimeAsync(90_000)).resolves.not.toThrow();
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });
});

describe('rescheduleActiveSegments', () => {
  it('re-arms one timer per segment still running', async () => {
    // A deploy drops every in-memory timer. Without this a debate that was
    // mid-segment when the service restarted never advances again.
    query
      .mockResolvedValueOnce({ rows: [{ id: SEGMENT, debate_id: DEBATE }] })
      .mockResolvedValueOnce(segmentRow());

    await expect(rescheduleActiveSegments()).resolves.toBe(1);
    expect(pendingExpiryCount()).toBe(1);
  });

  it('asks only for segments of live debates, never the whole table', async () => {
    // This instance is shared and on a daily Disk IO budget (CLAUDE.md).
    query.mockResolvedValueOnce({ rows: [] });
    await rescheduleActiveSegments();

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("d.status = 'live'");
  });

  it('returns 0 rather than throwing when the lookup fails', async () => {
    // This runs inside instrumentation.register(). A rejection here would
    // refuse to boot the server.
    query.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(rescheduleActiveSegments()).resolves.toBe(0);
  });
});

describe('review findings', () => {
  it('does not arm timers in a process that should not be acting', async () => {
    // Same hazard as the abandon watcher, and worse in one way: a local
    // checkout pointed at the shared database would end segments in a real
    // debate. Unset credentials do not save us here — this path needs only
    // the database, which a local checkout has.
    expect(shouldRunSegmentExpiry({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldRunSegmentExpiry({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldRunSegmentExpiry({ NODE_ENV: 'development', SEGMENT_EXPIRY: '1' })).toBe(true);
    expect(shouldRunSegmentExpiry({ NODE_ENV: 'production', SEGMENT_EXPIRY: '0' })).toBe(false);
  });

  it('leaves no orphaned timer when two schedules overlap', async () => {
    // cancel runs at the top, the arm runs after an await. Two concurrent
    // calls both cancel nothing, then both arm — and the second overwrites
    // the map entry, leaving the first armed and unreachable. It fires later
    // on a deadline nobody holds and ends the segment early.
    let release: (v: unknown) => void = () => {};
    const gate = new Promise(r => { release = r; });

    // The first call reads a 90s deadline and arms it. The second reads a
    // 630s one and arms that, overwriting the map entry. The first timer is
    // then unreachable: every cancel path works through the map.
    query.mockResolvedValueOnce(segmentRow());
    const first = scheduleSegmentExpiry(DEBATE, SEGMENT);

    query.mockImplementationOnce(async () => {
      await gate;
      return segmentRow({ end_time: new Date(NOW + 600_000).toISOString() });
    });
    const second = scheduleSegmentExpiry(DEBATE, SEGMENT);

    await first;
    release(undefined);
    await second;

    expect(pendingExpiryCount()).toBe(1);

    // Only the 630s deadline survives, so nothing may fire inside 120s. An
    // orphan from the first call would end the segment here, nine minutes
    // early, on a deadline the moderator has already replaced.
    query.mockResolvedValue(fireRow());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(performSegmentEnd).not.toHaveBeenCalled();
  });

  it('tries again after a transient failure instead of dropping the deadline', async () => {
    // The timer removes itself before expireSegment runs, and the catch only
    // logged. One failed LiveKit call therefore disabled expiry for that
    // segment permanently — back to depending on the moderator's tab.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());
    performSegmentEnd.mockRejectedValueOnce(new Error('livekit unreachable'));

    await vi.advanceTimersByTimeAsync(90_000);
    expect(performSegmentEnd).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(EXPIRY_RETRY_MS);
    expect(performSegmentEnd).toHaveBeenCalledTimes(2);
  });

  it('gives up loudly rather than retrying for ever', async () => {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());
    performSegmentEnd.mockRejectedValue(new Error('livekit unreachable'));

    await vi.advanceTimersByTimeAsync(90_000);
    for (let i = 0; i < EXPIRY_MAX_ATTEMPTS + 2; i++) {
      await vi.advanceTimersByTimeAsync(EXPIRY_RETRY_MS);
    }

    expect(performSegmentEnd).toHaveBeenCalledTimes(EXPIRY_MAX_ATTEMPTS);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('stops retrying once an attempt succeeds', async () => {
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow());
    performSegmentEnd.mockRejectedValueOnce(new Error('transient'));

    await vi.advanceTimersByTimeAsync(90_000);
    await vi.advanceTimersByTimeAsync(EXPIRY_RETRY_MS);
    expect(performSegmentEnd).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(EXPIRY_RETRY_MS * 5);
    expect(performSegmentEnd).toHaveBeenCalledTimes(2);
    expect(pendingExpiryCount()).toBe(0);
  });

  it('does not retry when the segment simply is not active any more', async () => {
    // Not a failure — the moderator got there first. Retrying would be noise.
    query.mockResolvedValueOnce(segmentRow());
    await scheduleSegmentExpiry(DEBATE, SEGMENT);
    query.mockResolvedValue(fireRow({ status: 'completed' }));

    await vi.advanceTimersByTimeAsync(90_000);
    await vi.advanceTimersByTimeAsync(EXPIRY_RETRY_MS * 3);
    expect(performSegmentEnd).not.toHaveBeenCalled();
    expect(pendingExpiryCount()).toBe(0);
  });
});
