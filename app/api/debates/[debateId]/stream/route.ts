import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  // Anonymous observers are permitted — RLS grants anon SELECT on live/completed debates.
  // The route uses the service-role pool, so we enforce the same status gate explicitly
  // to avoid leaking whether a scheduled/cancelled debate exists.
  const { rows } = await getPool().query<{
    mux_playback_id: string | null;
    status: string;
  }>(
    `SELECT mux_playback_id, status
     FROM listening.debates
     WHERE id = $1
       AND status IN ('live', 'completed')`,
    [debateId],
  );

  if (rows.length === 0) {
    // Return 404 regardless of whether the debate exists — do not leak unpublished state.
    return NextResponse.json({ error: 'Debate not available' }, { status: 404 });
  }

  return NextResponse.json(
    { mux_playback_id: rows[0].mux_playback_id, status: rows[0].status },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
