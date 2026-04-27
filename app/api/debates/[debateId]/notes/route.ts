export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { verifyToken } from '@/lib/auth/jwks';
import { requireConnectedTier, mapTierError } from '@/lib/auth/connected';

/**
 * NoteRow — shape returned by every notes API endpoint.
 * Also exported for use in the Zustand notesStore.
 */
export interface NoteRow {
  id: string;
  debate_id: string;
  content: string;
  debate_time_mmss: string | null;
  created_at: string;
  updated_at: string | null;
  is_edited: boolean;
  rebuttal_order: number | null;
  source_transcript_entry_id: string | null;
}

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

/**
 * GET /api/debates/[debateId]/notes
 *
 * Returns the authenticated user's notes for the debate, ordered by
 * created_at ASC.  Never returns another user's notes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  const pool = getPool();

  // Confirm debate exists
  const debateCheck = await pool.query(
    `SELECT 1 FROM listening.debates WHERE id = $1`,
    [debateId],
  );
  if (debateCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  const result = await pool.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS}
     FROM listening.notes
     WHERE debate_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [debateId, userId],
  );

  const res = NextResponse.json({ notes: result.rows });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

const postBodySchema = z.object({
  content: z.string().trim().min(1).max(2000),
  debateTimeMmss: z.string().regex(/^\d{1,3}:\d{2}$/).nullable(),
  sourceTranscriptEntryId: z.string().uuid().nullable().optional(),
});

/**
 * POST /api/debates/[debateId]/notes
 *
 * Creates a new note for the authenticated Connected/Empowered user.
 * Inform-tier accounts receive 403.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
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

  // Tier check — Inform accounts cannot create notes
  try {
    await requireConnectedTier(bearer);
  } catch (err) {
    const { status, body } = mapTierError(err);
    return NextResponse.json(body, { status });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = postBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { content, debateTimeMmss, sourceTranscriptEntryId } = parsed.data;

  const pool = getPool();
  const result = await pool.query<NoteRow>(
    `INSERT INTO listening.notes
       (user_id, debate_id, content, debate_time_mmss, source_transcript_entry_id, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING ${NOTE_COLUMNS}`,
    [userId, debateId, content, debateTimeMmss ?? null, sourceTranscriptEntryId ?? null],
  );

  return NextResponse.json({ note: result.rows[0] }, { status: 201 });
}
