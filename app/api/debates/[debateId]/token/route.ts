import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyToken } from '@/lib/auth/jwks';
import { mintToken } from '@/lib/livekit/tokens';
import { getPool } from '@/lib/db/pool';
import { isDebateJoinable } from '@/lib/debate/joinable';
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
    ({ userId } = await verifyToken(bearer));
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
    debate_status: string;
  }>(
    `SELECT ds.role, ds.user_id, ds.livekit_identity, d.livekit_room_name, d.status AS debate_status
     FROM listening.debate_speakers ds
     JOIN listening.debates d ON d.id = ds.debate_id
     WHERE ds.id = $1 AND ds.debate_id = $2`,
    [speakerId, debateId],
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Speaker slot not found' }, { status: 404 });
  const slot = rows[0];

  // A seat is only joinable while the debate is still ahead of us or running.
  // The debate id is public (the observer page is anonymous), so without this a
  // share link that reached the wrong person stayed good forever — including on
  // a debate that was finished or deliberately cancelled.  Checked here and not
  // in a policy because getPool() connects as `postgres` and bypasses RLS.
  if (!isDebateJoinable(slot.debate_status)) {
    return NextResponse.json({ error: 'This debate is not open to join' }, { status: 409 });
  }

  if (slot.user_id === null) {
    // Claim the seat.  The status is re-checked inside the UPDATE because the
    // SELECT above is a separate statement — the debate can be cancelled in
    // between — and `user_id IS NULL` makes the claim itself atomic.
    const claim = await pool.query(
      `UPDATE listening.debate_speakers ds
          SET user_id = $1
         FROM listening.debates d
        WHERE ds.id = $2
          AND ds.user_id IS NULL
          AND d.id = ds.debate_id
          AND d.status IN ('scheduled', 'live')`,
      [userId, speakerId],
    );

    // No row updated means someone else won the race, or the debate closed
    // under us.  The old code ignored this and minted a token anyway, which
    // handed two people the same LiveKit identity for the same seat.
    if (claim.rowCount === 0) {
      return NextResponse.json({ error: 'Slot already claimed by another user' }, { status: 403 });
    }
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
