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
  try {
    await verifyToken(bearer);
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { rows } = await getPool().query<{
    mux_playback_id: string | null;
    status: string;
  }>(
    `SELECT mux_playback_id, status
     FROM listening.debates WHERE id = $1`,
    [debateId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  return NextResponse.json({
    mux_playback_id: rows[0].mux_playback_id,
    status: rows[0].status,
  });
}
