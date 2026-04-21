import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { startSegment, endSegment, repeatSegment } from '@/lib/debate/transitions';
import { applySegmentMicPermissions } from '@/lib/debate/mic-control';
import { getPool } from '@/lib/db/pool';

const bodySchema = z.object({
  action: z.enum(['start', 'end', 'repeat']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; segmentId: string }> },
) {
  const { debateId, segmentId } = await params;

  let moderatorUserId: string;
  try {
    moderatorUserId = await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { action } = parsed.data;

  // Resolve allocated_seconds for the segment — needed for start / repeat
  const pool = getPool();
  const { rows } = await pool.query<{ allocated_seconds: number }>(
    `SELECT allocated_seconds FROM listening.debate_segments WHERE id = $1 AND debate_id = $2`,
    [segmentId, debateId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  const durationSeconds = rows[0].allocated_seconds;

  try {
    if (action === 'start') {
      const segment = await startSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
      await applySegmentMicPermissions(debateId, segmentId);
      return NextResponse.json({ segment });
    }

    if (action === 'end') {
      const segment = await endSegment({ debateId, segmentId, moderatorUserId });
      // After end, no segment is active — mute both speakers (between-segment state).
      // applySegmentMicPermissions reads the segment_type that was just ended, which would
      // re-grant mics.  Between-segment muting is handled by a separate call path: revoke both.
      // Here we inline the revoke to keep the route self-contained.
      const { rows: speakerRows } = await pool.query<{ role: string; livekit_identity: string }>(
        `SELECT role, livekit_identity FROM listening.debate_speakers WHERE debate_id = $1 AND role IN ('affirmative','negative')`,
        [debateId],
      );
      const { rows: debateRows } = await pool.query<{ livekit_room_name: string }>(
        `SELECT livekit_room_name FROM listening.debates WHERE id = $1`, [debateId]);
      if (debateRows.length > 0) {
        const { setMicPermission } = await import('@/lib/livekit/room-service');
        await Promise.allSettled(
          speakerRows.map(s => setMicPermission(debateRows[0].livekit_room_name, s.livekit_identity, false)),
        );
      }
      return NextResponse.json({ segment });
    }

    // 'repeat' — full reset of the segment timer + clear bonus used; re-apply mic permissions
    const segment = await repeatSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
    await applySegmentMicPermissions(debateId, segmentId);
    return NextResponse.json({ segment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // RPC RAISE EXCEPTION text bubbles up here — surface to the moderator UI
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
