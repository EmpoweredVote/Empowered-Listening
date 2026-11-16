import 'server-only';
import { getPool } from '@/lib/db/pool';
import { endSegment } from '@/lib/debate/transitions';
import { teardownDebateMedia } from '@/lib/debate/teardown';
import { notifyDebateChanged } from '@/lib/debate/notify';
import type { SegmentRow } from '@/lib/debate/transitions';

/**
 * Everything that has to happen when a segment ends.
 *
 * This used to live inline in the segments route, which was fine while the
 * only thing that could end a segment was the moderator's browser tab. The
 * server-side expiry timer now ends segments too, and it has to do the *whole*
 * job — a debate whose final segment auto-expired would otherwise leave the
 * LiveKit egress running, the Mux stream open, the Deepgram worker subscribed,
 * both speakers' mics live, and every connected client still showing a segment
 * that is over.
 *
 * Safe to run twice. `end_segment` charges the bonus pool only on the
 * transition out of 'active', `teardownDebateMedia` is explicitly re-runnable,
 * and revoking a mic that is already revoked is a no-op.
 */
export async function performSegmentEnd(args: {
  debateId: string;
  segmentId: string;
  moderatorUserId: string;
}): Promise<SegmentRow> {
  const { debateId, segmentId, moderatorUserId } = args;
  const pool = getPool();

  const segment = await endSegment({ debateId, segmentId, moderatorUserId });

  // end_segment flips the debate to 'completed' when this was the last
  // segment. That is the only case where the debate's media should be
  // released — a debate between segments is still running.
  const { rows: statusRows } = await pool.query<{ status: string }>(
    `SELECT status FROM listening.debates WHERE id = $1`,
    [debateId],
  );

  if (statusRows[0]?.status === 'completed') {
    // One teardown path, shared with POST /end, the abandon watcher and the
    // orphan sweep, so egress, Mux and the transcription worker can only be
    // released one way. This was inlined here once, which is why every other
    // way a debate could end leaked all three — see CLAUDE.md.
    await teardownDebateMedia(debateId);
  }

  await revokeSpeakerMics(debateId);

  // Sent last, once the segment is closed, the media is released and the mics
  // are down: clients answer this by re-reading the snapshot, and if it
  // arrived first they would re-read a state that is still changing.
  await notifyDebateChanged(debateId, 'segment-end');

  return segment;
}

/**
 * Force canPublish=false on both debating speakers.
 *
 * After a segment ends no segment is active, so neither speaker should hold a
 * live microphone. `applySegmentMicPermissions` cannot be used for this: it
 * reads the segment_type that was just ended and would re-grant exactly the
 * mic we are trying to take down.
 *
 * This is also the body of `handleBonusExhaustion`, written in Phase 2 for
 * "mute the mic when the bonus pool reaches zero" and never called by
 * anything. With expiry driven server-side, pool exhaustion now *is* the end
 * of the segment, so the mute happens here rather than on a separate path.
 */
export async function revokeSpeakerMics(debateId: string): Promise<void> {
  const pool = getPool();

  const { rows: speakerRows } = await pool.query<{ role: string; livekit_identity: string }>(
    `SELECT role, livekit_identity FROM listening.debate_speakers
      WHERE debate_id = $1 AND role IN ('affirmative','negative')`,
    [debateId],
  );
  const { rows: debateRows } = await pool.query<{ livekit_room_name: string | null }>(
    `SELECT livekit_room_name FROM listening.debates WHERE id = $1`,
    [debateId],
  );
  const roomName = debateRows[0]?.livekit_room_name;
  if (!roomName) return;

  const { setMicPermission } = await import('@/lib/livekit/room-service');
  // allSettled, not all: one speaker whose seat LiveKit no longer knows about
  // must not leave the other speaker's microphone live.
  await Promise.allSettled(
    speakerRows
      .filter(s => s.livekit_identity)
      .map(s => setMicPermission(roomName, s.livekit_identity, false)),
  );
}
