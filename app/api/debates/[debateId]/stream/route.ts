import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import {
  DEBATE_VIDEO_COLUMNS,
  resolveDebateVideo,
  type DebateVideoRow,
} from '@/lib/debates/recording';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  // Anonymous observers are permitted — RLS grants anon SELECT on live/completed debates.
  // The route uses the service-role pool, so we enforce the same status gate explicitly
  // to avoid leaking whether a scheduled/cancelled debate exists.
  const { rows } = await getPool().query<DebateVideoRow>(
    `SELECT ${DEBATE_VIDEO_COLUMNS}
     FROM listening.debates
     WHERE id = $1
       AND status IN ('live', 'completed')`,
    [debateId],
  );

  if (rows.length === 0) {
    // Return 404 regardless of whether the debate exists — do not leak unpublished state.
    return NextResponse.json({ error: 'Debate not available' }, { status: 404 });
  }

  // mux_playback_id is the ID to play now: the live stream while live, the
  // recording once completed.
  const video = await resolveDebateVideo(rows[0]);
  return NextResponse.json(
    {
      mux_playback_id: video.playbackId,
      status: rows[0].status,
      recording_pending: video.recordingPending,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
