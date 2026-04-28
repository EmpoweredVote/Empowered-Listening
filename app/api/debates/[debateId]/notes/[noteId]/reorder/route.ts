export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { verifyToken } from '@/lib/auth/jwks';
import { requireConnectedTier, mapTierError } from '@/lib/auth/connected';

/** Return the raw bearer string, or null if missing/malformed. */
function getBearerFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

const reorderBodySchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * PUT /api/debates/[debateId]/notes/[noteId]/reorder
 *
 * Atomically writes rebuttal_order for the user's notes in this debate.
 *
 * The noteId path param identifies the most-recently-moved item for URL
 * symmetry, but the server operates on the full orderedIds array in the body.
 *
 * Requires Connected or Empowered tier.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; noteId: string }> },
) {
  const { debateId } = await params;

  const bearer = getBearerFromRequest(req);
  if (!bearer) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  let userId: string;
  try {
    const payload = await verifyToken(bearer);
    userId = (payload.sub as string) ?? null;
    if (!userId) throw new Error('No sub');
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // Tier check — Inform accounts cannot reorder notes
  try {
    await requireConnectedTier(bearer);
  } catch (err) {
    const { status, body } = mapTierError(err);
    return NextResponse.json(body, { status });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = reorderBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { orderedIds } = parsed.data;

  const pool = getPool();

  // Ownership check: all submitted IDs must belong to this user + debate
  const ownershipResult = await pool.query<{ id: string }>(
    `SELECT id FROM listening.notes
     WHERE debate_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])`,
    [debateId, userId, orderedIds],
  );

  if (ownershipResult.rows.length !== orderedIds.length) {
    return NextResponse.json(
      { error: 'Some notes do not belong to this user/debate' },
      { status: 400 },
    );
  }

  // Build a VALUES list: (uuid, order_index) pairs
  // e.g. for 3 ids: ($1, 0), ($2, 1), ($3, 2) with userId as $4
  const valuePlaceholders = orderedIds
    .map((_, i) => `($${i + 1}::uuid, ${i})`)
    .join(', ');
  const userIdParam = `$${orderedIds.length + 1}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE listening.notes AS n
       SET rebuttal_order = v.ord::int
       FROM (VALUES ${valuePlaceholders}) AS v(id, ord)
       WHERE n.id = v.id AND n.user_id = ${userIdParam}`,
      [...orderedIds, userId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reorder] transaction failed:', err);
    return NextResponse.json({ error: 'Failed to reorder notes' }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true });
}
