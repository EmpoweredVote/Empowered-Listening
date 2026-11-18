import { NextRequest, NextResponse } from 'next/server';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { getPool } from '@/lib/db/pool';

export const runtime = 'nodejs'; // pool.query requires the Node.js runtime

export interface ModeratorTranscriptEntry {
  id: string;
  debate_id: string;
  speaker_id: string;
  spoken_at: string;
  debate_time_mmss: string;
  text: string;
  original_text: string | null;
  edited: boolean;
  edited_at: string | null;
  edited_by: string | null;
  display_name: string | null;
  speaker_role: 'affirmative' | 'negative' | 'moderator' | null;
}

/**
 * GET /api/moderator/debates/[debateId]/transcript
 *
 * The transcript as its moderator may edit it — including `original_text`,
 * which is the unedited speech of named people and exists nowhere a viewer
 * can reach.
 *
 * 🔴 The page that shows this used to be a server component that queried the
 * pool with no auth check at all. `/debates/[debateId]` is anonymous by
 * design, so debate ids are public: anyone holding one could read any
 * debate's full transcript and every pre-correction original. Writes were
 * never exposed — `correct_transcript_entry` has always checked the caller —
 * but nothing checked reads.
 *
 * The gate matches that RPC exactly, rather than inventing a second rule:
 * the caller must hold this debate's `moderator` speaker row. Read access and
 * edit access are then the same thing, which is the only sane invariant for a
 * page whose purpose is editing.
 *
 * The service-role pool bypasses RLS, so this lives in the SQL, not a policy.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  let userId: string;
  try {
    userId = await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[moderator-transcript] token verification failed:', e);
    return NextResponse.json(
      { error: 'Auth failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 401 },
    );
  }

  const pool = getPool();

  const { rows: debateRows } = await pool.query<{ status: string; moderator_name: string | null }>(
    `SELECT d.status,
            (SELECT ds2.display_name
               FROM listening.debate_speakers ds2
              WHERE ds2.debate_id = d.id AND ds2.role = 'moderator'
              LIMIT 1) AS moderator_name
       FROM listening.debates d
      WHERE d.id = $1
        AND EXISTS (
          SELECT 1
            FROM listening.debate_speakers ds
           WHERE ds.debate_id = d.id
             AND ds.user_id = $2
             AND ds.role = 'moderator'
        )`,
    [debateId, userId],
  );

  // One 404 for "no such debate" and for "not your debate" alike — holding the
  // listening_moderator role must not let someone confirm another moderator's
  // debate exists. Same reasoning as the share-links and notes routes.
  if (debateRows.length === 0) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  const { status, moderator_name } = debateRows[0];

  // Mirrors the RPC's second guard: no transcript review before the debate is
  // over. Returned rather than refused so the page can redirect the moderator
  // back to the debate they are evidently still running.
  if (status !== 'completed') {
    return NextResponse.json(
      { status, moderatorName: moderator_name ?? 'Moderator', entries: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { rows: entries } = await pool.query<ModeratorTranscriptEntry>(
    `SELECT te.id, te.debate_id, te.speaker_id, te.spoken_at, te.debate_time_mmss,
            te.text, te.original_text, te.edited, te.edited_at, te.edited_by,
            ds.display_name, ds.role AS speaker_role
       FROM listening.transcript_entries te
       LEFT JOIN listening.debate_speakers ds ON ds.id = te.speaker_id
      WHERE te.debate_id = $1
      ORDER BY te.spoken_at ASC`,
    [debateId],
  );

  return NextResponse.json(
    { status, moderatorName: moderator_name ?? 'Moderator', entries },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
