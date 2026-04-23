export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';

/**
 * GET /api/debates/[debateId]/transcript
 *
 * Anonymous-accessible transcript snapshot endpoint.
 * No auth required — transcript is a public civic record.
 *
 * Query parameters:
 *   before  (optional ISO timestamp): cursor — returns entries with spoken_at < before
 *   limit   (optional integer, default 50, max 200)
 *
 * The debate existence gate uses the service-role pool (bypasses RLS), so we
 * guard explicitly in the WHERE clause (same pattern as observer-snapshot).
 */

export interface TranscriptEntryRow {
  id: string;
  speaker_id: string;
  spoken_at: string;        // ISO timestamp string
  debate_time_mmss: string;
  text: string;
  confidence_score: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;
  const pool = getPool();

  // Parse query params
  const url = req.nextUrl;
  const beforeParam = url.searchParams.get('before') ?? null;
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  // Gate: verify debate exists (any status — transcript is a public record regardless of status)
  const debateCheck = await pool.query(
    `SELECT id FROM listening.debates WHERE id = $1`,
    [debateId],
  );

  if (debateCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  // Fetch transcript entries with optional cursor pagination
  const result = await pool.query<TranscriptEntryRow>(
    `SELECT
       te.id,
       te.speaker_id,
       te.spoken_at,
       te.debate_time_mmss,
       te.text,
       te.confidence_score
     FROM listening.transcript_entries te
     WHERE te.debate_id = $1
       AND ($2::timestamptz IS NULL OR te.spoken_at < $2)
     ORDER BY te.spoken_at ASC
     LIMIT $3`,
    [debateId, beforeParam, limit],
  );

  const res = NextResponse.json({ entries: result.rows });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
