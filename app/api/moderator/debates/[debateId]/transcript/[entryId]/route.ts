export const runtime = 'nodejs'; // pool.query requires Node.js runtime

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { getPool } from '@/lib/db/pool';

const bodySchema = z.object({
  text: z.string().min(1).max(10000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; entryId: string }> },
) {
  const { debateId, entryId } = await params;

  // 1. Verify auth — extract user ID from JWT using moderator gate
  let userId: string;
  try {
    userId = await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
  }

  // 2. Validate request body
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body: text must be 1–10000 characters' }, { status: 400 });
  }
  const { text: newText } = parsed.data;

  // 3. Call RPC via pool.query
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT * FROM listening.correct_transcript_entry($1, $2, $3, $4)`,
      [entryId, newText, userId, debateId],
    );
    // 4. Return the updated entry as JSON
    return NextResponse.json({ entry: rows[0] });
  } catch (e) {
    // 5. Handle RPC RAISE EXCEPTION messages — map to correct HTTP status codes
    const msg = e instanceof Error ? e.message : 'Unknown error';

    if (msg.includes('Not authorized: caller is not the debate moderator')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    if (msg.includes('Cannot edit transcript of an active or scheduled debate')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes('Transcript entry not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    console.error('[transcript-correction] RPC error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
