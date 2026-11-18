import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { getPool } from '@/lib/db/pool';
import { teardownDebateMedia } from '@/lib/debate/teardown';
import { notifyDebateChanged } from '@/lib/debate/notify';

// Required: reaches pg directly and through the moderator gate.
export const runtime = 'nodejs';

const bodySchema = z.object({
  /**
   * 'completed' is a debate that ran. 'cancelled' is one abandoned — a test
   * that will not be finished, or a sitting called off. Both release media;
   * the distinction is what the record says happened.
   */
  outcome: z.enum(['completed', 'cancelled']).default('completed'),
});

/**
 * End a debate and release everything it holds.
 *
 * Before this existed, the only way to stop a debate's LiveKit egress was to
 * drive it to the end of its final segment. Closing the tab instead left the
 * egress running — one ran 6h18m and recorded an empty room — and left the
 * Mux stream open and the Deepgram worker subscribed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  try {
    await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[end] token verification failed:', e);
    return NextResponse.json(
      { error: 'Auth failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { outcome } = parsed.data;

  const pool = getPool();

  // The service-role pool bypasses RLS, so the status gate is in the SQL
  // rather than a policy (CLAUDE.md). Only a debate that has not already
  // finished can be ended.
  const { rows } = await pool.query<{ status: string }>(
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
    // up would make this route useless for the mess it exists to fix.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM listening.debates WHERE id = $1`,
      [debateId],
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
    }
    const teardown = await teardownDebateMedia(debateId);
    return NextResponse.json({ status: 'already ended', teardown });
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

  return NextResponse.json({ status: rows[0].status, teardown });
}
