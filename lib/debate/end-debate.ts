import 'server-only';
import { getPool } from '@/lib/db/pool';
import { teardownDebateMedia, type TeardownResult } from '@/lib/debate/teardown';
import { notifyDebateChanged } from '@/lib/debate/notify';
import type { EndOutcome } from '@/lib/debate/end-debate-state';

/**
 * End a debate and release everything it holds.
 *
 * Lifted out of `POST /api/debates/[debateId]/end` so that route and
 * `lib/debate/abandon-watch.ts` cannot drift. CLAUDE.md is explicit that
 * `teardownDebateMedia` is the only correct way to release the egress, the
 * Mux stream and the transcription worker, and the way that rule gets broken
 * is not by anyone disagreeing with it — it is by a second ending growing its
 * own copy of the sequence. There is one ending; this is it.
 *
 * Before the route existed, the only way to stop a debate's LiveKit egress was
 * to drive it to the end of its final segment. Closing the tab instead left
 * the egress running — one ran 6h18m and recorded an empty room — and left the
 * Mux stream open and the Deepgram worker subscribed.
 */
export interface EndDebateResult {
  /** The status now stored, or 'already ended' when the row was past ending. */
  status: EndOutcome | 'already ended';
  teardown: TeardownResult;
}

/**
 * Returns `null` when no such debate exists; callers map that to a 404.
 */
export async function endDebate(
  debateId: string,
  outcome: EndOutcome,
): Promise<EndDebateResult | null> {
  const pool = getPool();

  // The service-role pool bypasses RLS, so the status gate is in the SQL
  // rather than a policy (CLAUDE.md). Only a debate that has not already
  // finished can be ended.
  const { rows } = await pool.query<{ status: EndOutcome }>(
    `UPDATE listening.debates
     SET status = $2, end_time = COALESCE(end_time, NOW())
     WHERE id = $1 AND status IN ('scheduled', 'live')
     RETURNING status`,
    [debateId, outcome],
  );

  if (rows.length === 0) {
    // Either no such debate, or it is already completed/cancelled. Still run
    // teardown: a debate can hold a live egress while its row says completed,
    // which is exactly the state that leaked before, and refusing to clean it
    // up would make this useless for the mess it exists to fix.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM listening.debates WHERE id = $1`,
      [debateId],
    );
    if (rowCount === 0) return null;

    const teardown = await teardownDebateMedia(debateId);
    return { status: 'already ended', teardown };
  }

  // Close any segment still running, so the debate does not read as mid-segment forever.
  await pool.query(
    `UPDATE listening.debate_segments
     SET status = 'completed', actual_end = COALESCE(actual_end, NOW())
     WHERE debate_id = $1 AND status IN ('active', 'paused')`,
    [debateId],
  );

  const teardown = await teardownDebateMedia(debateId);

  // Speakers and observers are still sitting on this debate; tell them it is over.
  await notifyDebateChanged(debateId, 'debate-end');

  return { status: rows[0].status, teardown };
}
