import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyToken } from '@/lib/auth/jwks';
import { mintToken } from '@/lib/livekit/tokens';
import { getPool } from '@/lib/db/pool';
import { env } from '@/lib/env';

const bodySchema = z.object({
  speakerId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

  let userId: string;
  try {
    const payload = await verifyToken(bearer);
    userId = payload.sub as string;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { speakerId } = parsed.data;

  const pool = getPool();
  const { rows } = await pool.query<{
    role: 'affirmative' | 'negative' | 'moderator';
    user_id: string | null;
    livekit_identity: string;
    livekit_room_name: string;
  }>(
    `SELECT ds.role, ds.user_id, ds.livekit_identity, d.livekit_room_name
     FROM listening.debate_speakers ds
     JOIN listening.debates d ON d.id = ds.debate_id
     WHERE ds.id = $1 AND ds.debate_id = $2`,
    [speakerId, debateId],
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Speaker slot not found' }, { status: 404 });
  const slot = rows[0];

  if (slot.user_id === null) {
    // Claim the slot — conditional UPDATE prevents race conditions
    await pool.query(
      `UPDATE listening.debate_speakers SET user_id = $1 WHERE id = $2 AND user_id IS NULL`,
      [userId, speakerId],
    );
  } else if (slot.user_id !== userId) {
    return NextResponse.json({ error: 'Slot already claimed by another user' }, { status: 403 });
  }

  const role: 'speaker' | 'moderator' = slot.role === 'moderator' ? 'moderator' : 'speaker';
  const livekitToken = await mintToken({
    identity: slot.livekit_identity,
    roomName: slot.livekit_room_name,
    role,
  });

  return NextResponse.json({
    token: livekitToken,
    serverUrl: env.LIVEKIT_URL,
    identity: slot.livekit_identity,
    role,
  });
}
