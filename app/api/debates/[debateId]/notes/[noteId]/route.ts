export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { verifyToken } from '@/lib/auth/jwks';
import { requireConnectedTier, mapTierError } from '@/lib/auth/connected';
import type { NoteRow } from '@/app/api/debates/[debateId]/notes/route';

const NOTE_COLUMNS = `
  id,
  debate_id,
  content,
  debate_time_mmss,
  created_at,
  updated_at,
  is_edited,
  rebuttal_order,
  source_transcript_entry_id
`;

/** Extract and verify the bearer token; return userId (sub) or null. */
async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer) return null;
  try {
    const payload = await verifyToken(bearer);
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

/** Return the raw bearer string, or null if missing/malformed. */
function getBearerFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

const putBodySchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

/**
 * PUT /api/debates/[debateId]/notes/[noteId]
 *
 * Updates note content and marks is_edited=true.  Returns 404 for both
 * "not found" and "not owned" — no ownership info is leaked.
 * Requires Connected or Empowered tier.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; noteId: string }> },
) {
  const { debateId, noteId } = await params;

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

  // Tier check — Inform accounts cannot edit notes
  try {
    await requireConnectedTier(bearer);
  } catch (err) {
    const { status, body } = mapTierError(err);
    return NextResponse.json(body, { status });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = putBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { content } = parsed.data;

  const pool = getPool();
  const result = await pool.query<NoteRow>(
    `UPDATE listening.notes
     SET content = $1, is_edited = true, updated_at = NOW()
     WHERE id = $2 AND debate_id = $3 AND user_id = $4
     RETURNING ${NOTE_COLUMNS}`,
    [content, noteId, debateId, userId],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return NextResponse.json({ note: result.rows[0] });
}

/**
 * DELETE /api/debates/[debateId]/notes/[noteId]
 *
 * Removes a note owned by the requesting user.  Returns 204 on success,
 * 404 if the note doesn't exist or belongs to another user.
 * No tier check — users can always delete their own data.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; noteId: string }> },
) {
  const { debateId, noteId } = await params;

  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM listening.notes
     WHERE id = $1 AND debate_id = $2 AND user_id = $3`,
    [noteId, debateId, userId],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
