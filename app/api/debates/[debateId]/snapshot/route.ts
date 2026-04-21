import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/jwks';
import { getPool } from '@/lib/db/pool';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
  if (!bearer) return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  try { await verifyToken(bearer); } catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }); }

  const pool = getPool();
  const [debate, segments, speakers] = await Promise.all([
    pool.query(`SELECT id, status, livekit_room_name FROM listening.debates WHERE id = $1`, [debateId]),
    pool.query(`SELECT id, debate_id, segment_type, speaker_id, sequence_order, allocated_seconds,
                       bonus_seconds_used, actual_start, actual_end, status,
                       end_time, prep_time_end_time, paused_remaining_seconds
                FROM listening.debate_segments WHERE debate_id = $1 ORDER BY sequence_order`, [debateId]),
    pool.query(`SELECT id, debate_id, user_id, role, display_name, bonus_time_seconds, prep_time_seconds, livekit_identity
                FROM listening.debate_speakers WHERE debate_id = $1`, [debateId]),
  ]);

  if (debate.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    debate: debate.rows[0],
    segments: segments.rows,
    speakers: speakers.rows,
  });
}
