import { NextRequest, NextResponse } from 'next/server';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { getPool } from '@/lib/db/pool';

export const runtime = 'nodejs';

interface SpeakerRow {
  id: string;
  role: 'affirmative' | 'negative' | 'moderator';
  display_name: string;
}

/**
 * GET /api/debates/[debateId]/share-links
 *
 * Returns the speaker slot ids a moderator needs to build join links.
 *
 * 🔴 A slot id IS the capability to claim that seat. `POST /token` claims any
 * slot whose `user_id` is still NULL for whoever presents the id first, and
 * `createDebate` leaves the affirmative and negative slots NULL on purpose —
 * the join link is the invitation. So these ids must never reach anyone but
 * the moderator who created the debate. The share page used to render them
 * from a server component with no auth at all, while `/debates/[debateId]`
 * is deliberately anonymous, which made the debate id — and therefore the
 * seats — public to any signed-in account.
 *
 * The service-role pool bypasses RLS, so ownership is enforced in the SQL,
 * not in a policy.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  let userId: string;
  try {
    userId = await requireModeratorFromRequest(req);
  } catch (err) {
    if (err instanceof ModeratorGateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getPool();
  const { rows } = await pool.query<SpeakerRow>(
    `SELECT ds.id, ds.role, ds.display_name
       FROM listening.debate_speakers ds
       JOIN listening.debates d ON d.id = ds.debate_id
      WHERE ds.debate_id = $1 AND d.created_by = $2
      ORDER BY ds.role`,
    [debateId, userId],
  );

  // One 404 for "no such debate" and for "not yours" alike — same reasoning as
  // the notes routes (05-02): never confirm a debate exists to a non-owner.
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  return NextResponse.json({ speakers: rows });
}
