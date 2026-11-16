import 'server-only';
import { getPool } from '@/lib/db/pool';
import { endSegment } from '@/lib/debate/transitions';
import { activeWorkers } from '@/lib/transcription/registry';
import type { SegmentRow } from '@/lib/debate/transitions';

/**
 * Everything that has to happen when a segment ends.
 *
 * This used to live inline in the segments route, which was fine while the
 * only thing that could end a segment was the moderator's browser tab. The
 * server-side expiry timer now ends segments too, and it has to do the *whole*
 * job — a debate whose final segment auto-expired would otherwise leave LiveKit
 * egress running, the Mux stream open, the Deepgram worker subscribed and both
 * speakers' mics live.
 *
 * Safe to run twice. `end_segment` charges the bonus pool only on the
 * transition out of 'active' (migration 20261116000000), the egress and worker
 * teardown is guarded on the debate already being 'completed', and revoking a
 * mic that is already revoked is a no-op.
 */
export async function performSegmentEnd(args: {
  debateId: string;
  segmentId: string;
  moderatorUserId: string;
}): Promise<SegmentRow> {
  const { debateId, segmentId, moderatorUserId } = args;
  const pool = getPool();

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

    // ---- Phase 04-02: stop transcription worker on debate completion ----
    const transcriptionWorker = activeWorkers.get(debateId);
    if (transcriptionWorker) {
      transcriptionWorker
        .stop()
        .catch((err) => console.error('[transcription] worker stop failed:', err));
      activeWorkers.delete(debateId);
    }
  }

  // After end, no segment is active — mute both speakers (between-segment state).
  // applySegmentMicPermissions reads the segment_type that was just ended, which
  // would re-grant mics. Revoke both instead.
  await revokeSpeakerMics(debateId);

  return segment;
}

/**
 * Force canPublish=false on both debating speakers.
 *
 * Also the body of `handleBonusExhaustion`, which was written in Phase 2 for
 * "mute the mic when the bonus pool reaches zero" and never called by anything.
 * With expiry driven server-side, pool exhaustion now *is* the end of the
 * segment, so the mute happens here rather than on a separate path.
 */
export async function revokeSpeakerMics(debateId: string): Promise<void> {
  const pool = getPool();

  const { rows: speakerRows } = await pool.query<{ role: string; livekit_identity: string }>(
    `SELECT role, livekit_identity FROM listening.debate_speakers
      WHERE debate_id = $1 AND role IN ('affirmative','negative')`,
    [debateId],
  );
  const { rows: debateRows } = await pool.query<{ livekit_room_name: string }>(
    `SELECT livekit_room_name FROM listening.debates WHERE id = $1`,
    [debateId],
  );
  if (debateRows.length === 0) return;

  const { setMicPermission } = await import('@/lib/livekit/room-service');
  await Promise.allSettled(
    speakerRows.map((s) =>
      setMicPermission(debateRows[0].livekit_room_name, s.livekit_identity, false),
    ),
  );
}
