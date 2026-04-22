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
      // Pre-transition debate to 'live' in its own transaction BEFORE startSegment.
      // Supabase Realtime evaluates the debate_segments RLS by querying debates.status.
      // When both happen in the same transaction, Realtime may see the pre-transaction
      // value ('scheduled') and block the event.  Committing this first ensures the
      // Realtime worker sees status='live' when it evaluates the segment change.
      await pool.query(
        `UPDATE listening.debates
         SET status = 'live', actual_start = COALESCE(actual_start, NOW())
         WHERE id = $1 AND status = 'scheduled'`,
        [debateId],
      );
      const segment = await startSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
      await applySegmentMicPermissions(debateId, segmentId);

      // ---- Phase 03-01: bootstrap Mux + LiveKit egress on first-segment start ----
      const { rows: debateRows } = await pool.query<{
        livekit_room_name: string;
        livekit_egress_id: string | null;
      }>(
        `SELECT livekit_room_name, livekit_egress_id FROM listening.debates WHERE id = $1`,
        [debateId],
      );
      const debateRow = debateRows[0];

      if (debateRow && !debateRow.livekit_egress_id) {
        try {
          const { createMuxLiveStream } = await import('@/lib/mux/client');
          const { startDebateEgress } = await import('@/lib/livekit/egress-service');

          const { muxStreamId, muxStreamKey, muxPlaybackId } = await createMuxLiveStream();

          await pool.query(
            `UPDATE listening.debates
             SET mux_stream_id = $1, mux_stream_key = $2, mux_playback_id = $3
             WHERE id = $4`,
            [muxStreamId, muxStreamKey, muxPlaybackId, debateId],
          );

          const egressId = await startDebateEgress(debateRow.livekit_room_name, muxStreamKey);

          await pool.query(
            `UPDATE listening.debates
             SET livekit_egress_id = $1, mux_stream_key = NULL
             WHERE id = $2`,
            [egressId, debateId],
          );
        } catch (egressErr) {
          console.error('[egress] bootstrap failed:', egressErr);
        }
      }

      return NextResponse.json({ segment });
    }

    if (action === 'end') {
      const segment = await endSegment({ debateId, segmentId, moderatorUserId });

      // ---- Phase 03-01: shut down egress + finalize Mux on last-segment end ----
      const { rows: statusRows } = await pool.query<{
        status: string;
        livekit_egress_id: string | null;
        mux_stream_id: string | null;
      }>(
        `SELECT status, livekit_egress_id, mux_stream_id
         FROM listening.debates WHERE id = $1`,
        [debateId],
      );
      const dbg = statusRows[0];

      if (dbg && dbg.status === 'completed') {
        try {
          if (dbg.livekit_egress_id) {
            const { stopDebateEgress } = await import('@/lib/livekit/egress-service');
            await stopDebateEgress(dbg.livekit_egress_id);
          }
          if (dbg.mux_stream_id) {
            const { completeMuxLiveStream } = await import('@/lib/mux/client');
            await completeMuxLiveStream(dbg.mux_stream_id);
          }
          await pool.query(
            `UPDATE listening.debates SET livekit_egress_id = NULL WHERE id = $1`,
            [debateId],
          );
        } catch (stopErr) {
          console.error('[egress] stop failed:', stopErr);
        }
      }

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
