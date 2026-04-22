import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';

/**
 * GET /api/debates/[debateId]/observer-snapshot
 *
 * Anonymous-accessible snapshot endpoint for observer clients.
 * No bearer token required — the caller is unauthenticated (OBS-02).
 *
 * The debate SELECT is gated on status IN ('live', 'completed') in SQL.
 * This mirrors the debates_select_public RLS policy but is enforced in
 * application SQL because the pool uses the service role and bypasses RLS.
 *
 * Scheduled and cancelled debates return 404, preventing observers from
 * accessing private pre-debate information.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;
  const pool = getPool();

  const debate = await pool.query(
    `SELECT id, status, livekit_room_name
     FROM listening.debates
     WHERE id = $1 AND status IN ('live', 'completed')`,
    [debateId],
  );

  if (debate.rows.length === 0) {
    return NextResponse.json({ error: 'Debate not available' }, { status: 404 });
  }

  const [segments, speakers] = await Promise.all([
    pool.query(
      `SELECT id, debate_id, segment_type, speaker_id, sequence_order, allocated_seconds,
              bonus_seconds_used, actual_start, actual_end, status,
              end_time, prep_time_end_time, paused_remaining_seconds
       FROM listening.debate_segments
       WHERE debate_id = $1
       ORDER BY sequence_order`,
      [debateId],
    ),
    pool.query(
      `SELECT id, debate_id, user_id, role, display_name, bonus_time_seconds, prep_time_seconds, livekit_identity
       FROM listening.debate_speakers
       WHERE debate_id = $1`,
      [debateId],
    ),
  ]);

  const res = NextResponse.json({
    debate: debate.rows[0],
    segments: segments.rows,
    speakers: speakers.rows,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
