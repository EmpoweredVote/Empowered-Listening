import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const teardownDebateMedia = vi.fn();
const notifyDebateChanged = vi.fn();

// Wrapped in arrows, not passed by reference: a vi.mock factory is hoisted
// above these declarations, so anything it evaluates eagerly reads an
// uninitialised binding. Same shape as the segments route test.
vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
  pool: { query: (...args: unknown[]) => query(...args) },
}));
vi.mock('@/lib/debate/teardown', () => ({
  teardownDebateMedia: (id: string) => teardownDebateMedia(id),
}));
vi.mock('@/lib/debate/notify', () => ({
  notifyDebateChanged: (id: string, reason: string) => notifyDebateChanged(id, reason),
}));

import { endDebate } from './end-debate';

const DEBATE = 'd008dcf0-4430-4537-a901-94d8719c0673';
const TEARDOWN = { egressStopped: false, muxCompleted: false, workerStopped: false, errors: [] };

/** The text of the Nth query this call issued. */
function sql(n: number): string {
  return String(query.mock.calls[n][0]);
}

beforeEach(() => {
  query.mockReset();
  teardownDebateMedia.mockReset().mockResolvedValue(TEARDOWN);
  notifyDebateChanged.mockReset().mockResolvedValue(undefined);
});

describe('endDebate', () => {
  it('writes the outcome, closes any running segment, tears down, then notifies', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ status: 'cancelled' }] }) // UPDATE debates
      .mockResolvedValueOnce({ rows: [] }); // UPDATE debate_segments

    const result = await endDebate(DEBATE, 'cancelled');

    expect(result).toEqual({ status: 'cancelled', teardown: TEARDOWN });
    expect(sql(0)).toContain('UPDATE listening.debates');
    // Only a debate that has not already finished can be ended. The gate is in
    // the SQL because the service-role pool bypasses RLS.
    expect(sql(0)).toContain("status IN ('scheduled', 'live')");
    expect(sql(1)).toContain('listening.debate_segments');
    expect(teardownDebateMedia).toHaveBeenCalledWith(DEBATE);
    expect(notifyDebateChanged).toHaveBeenCalledWith(DEBATE, 'debate-end');

    // The segment must be closed before teardown runs, or a debate can read as
    // mid-segment while its media is already gone.
    expect(query.mock.invocationCallOrder[1]).toBeLessThan(
      teardownDebateMedia.mock.invocationCallOrder[0],
    );
  });

  it('tears down even when the row had already ended, and reports "already ended"', async () => {
    // The state that leaked before: a debate holding a live egress while its
    // row says completed. Refusing to clean that up would make this useless
    // for the mess it exists to fix.
    query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE matched nothing
      .mockResolvedValueOnce({ rowCount: 1 }); // but the debate exists

    const result = await endDebate(DEBATE, 'cancelled');

    expect(result).toEqual({ status: 'already ended', teardown: TEARDOWN });
    expect(teardownDebateMedia).toHaveBeenCalledWith(DEBATE);
  });

  it('returns null when no such debate exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(endDebate(DEBATE, 'cancelled')).resolves.toBeNull();
    // Nothing to tear down, and nothing to say about a debate that is not there.
    expect(teardownDebateMedia).not.toHaveBeenCalled();
  });

  it('never reports a status the UPDATE did not write', async () => {
    // Artificial — the UPDATE writes the outcome it was given, so these agree
    // in practice. It pins the wiring: the reported status is read back from
    // the row, not echoed from the argument, so the caller is told what the
    // database holds.
    query
      .mockResolvedValueOnce({ rows: [{ status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await endDebate(DEBATE, 'cancelled');

    expect(result?.status).toBe('completed');
  });
});
