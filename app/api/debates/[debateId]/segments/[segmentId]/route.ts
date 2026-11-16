import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { startSegment, repeatSegment } from '@/lib/debate/transitions';
import { applySegmentMicPermissions } from '@/lib/debate/mic-control';
import { performSegmentEnd } from '@/lib/debate/end-segment-flow';
import { scheduleSegmentExpiry, cancelSegmentExpiry } from '@/lib/debate/expiry-registry';
import { getPool } from '@/lib/db/pool';
import { activeWorkers } from '@/lib/transcription/registry';
import { TranscriptionWorker } from '@/lib/transcription/worker';

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

      // Server-authoritative expiry. The moderator's tab no longer drives this.
      await scheduleSegmentExpiry(debateId, segmentId);

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

      // ---- Phase 04-02: bootstrap transcription worker on first-segment start ----
      if (!activeWorkers.has(debateId)) {
        try {
          const worker = new TranscriptionWorker(debateId, debateRow.livekit_room_name);
          activeWorkers.set(debateId, worker);
          worker.start().catch(err => {
            console.error('[transcription] worker start failed:', err);
            activeWorkers.delete(debateId);
          });
        } catch (workerErr) {
          console.error('[transcription] worker bootstrap failed:', workerErr);
        }
      }

      return NextResponse.json({ segment });
    }

    if (action === 'end') {
      // The timer, if any, has been superseded by this explicit end.
      cancelSegmentExpiry(segmentId);

      // Egress teardown, Mux finalize, transcription stop and mic revoke all
      // moved to performSegmentEnd so the server-side expiry timer runs the
      // identical path — see lib/debate/end-segment-flow.ts.
      const segment = await performSegmentEnd({ debateId, segmentId, moderatorUserId });
      return NextResponse.json({ segment });
    }

    // 'repeat' — full reset of the segment timer + clear bonus used; re-apply mic permissions
    const segment = await repeatSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
    await applySegmentMicPermissions(debateId, segmentId);
    // repeat resets end_time, so the old deadline is wrong — re-arm from the new one.
    await scheduleSegmentExpiry(debateId, segmentId);
    return NextResponse.json({ segment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // RPC RAISE EXCEPTION text bubbles up here — surface to the moderator UI
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
