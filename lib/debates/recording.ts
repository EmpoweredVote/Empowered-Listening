import 'server-only';
import { pool } from '@/lib/db/pool';

export type DebateStatus = 'live' | 'completed' | 'scheduled';

export interface DebateVideoRow {
  id: string;
  status: DebateStatus;
  mux_stream_id: string | null;
  mux_playback_id: string | null;
  mux_recording_playback_id: string | null;
}

export interface DebateVideo {
  /** Playback ID to build the HLS URL from, or null when there is nothing to play. */
  playbackId: string | null;
  /** Completed debate whose recording Mux is still preparing. */
  recordingPending: boolean;
}

/** SELECT list that matches DebateVideoRow. */
export const DEBATE_VIDEO_COLUMNS =
  'id, status, mux_stream_id, mux_playback_id, mux_recording_playback_id';

/**
 * Decide which Mux playback ID a viewer should get.
 *
 * - live: the live stream's playback ID.
 * - completed: the recorded asset's playback ID. The live ID stops working
 *   (HTTP 412) once the stream is completed. If the recording ID is not saved
 *   yet, ask Mux for it once and save it, so later views skip the lookup. This
 *   also backfills debates completed before the column existed.
 */
export async function resolveDebateVideo(row: DebateVideoRow): Promise<DebateVideo> {
  if (row.status === 'live') {
    return { playbackId: row.mux_playback_id, recordingPending: false };
  }
  if (row.status !== 'completed') {
    return { playbackId: null, recordingPending: false };
  }
  if (row.mux_recording_playback_id) {
    return { playbackId: row.mux_recording_playback_id, recordingPending: false };
  }
  if (!row.mux_stream_id) {
    // Debate never streamed to Mux — there is no recording to find.
    return { playbackId: null, recordingPending: false };
  }

  try {
    const { findLiveStreamRecording } = await import('@/lib/mux/client');
    const { playbackId, pending } = await findLiveStreamRecording(row.mux_stream_id);
    if (playbackId) {
      await pool.query(
        `UPDATE listening.debates
         SET mux_recording_playback_id = $1
         WHERE id = $2 AND mux_recording_playback_id IS NULL`,
        [playbackId, row.id],
      );
    }
    return { playbackId, recordingPending: pending };
  } catch (err) {
    console.error('[recording] Mux lookup failed for debate', row.id, err);
    return { playbackId: null, recordingPending: false };
  }
}
