export const runtime = 'nodejs'; // REQUIRED — renderToBuffer needs Node APIs

import { NextRequest } from 'next/server';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import React from 'react';
import { getPool } from '@/lib/db/pool';
import { verifyToken } from '@/lib/auth/jwks';
import { getAccountMe } from '@/lib/auth/account';
import { DebateNotesPdf } from '@/components/pdf/DebateNotesPdf';

// ---------------------------------------------------------------------------
// DB row types (local — not shared; avoid import from notes/route.ts)
// ---------------------------------------------------------------------------

interface DebateRow {
  id: string;
  topic: string;
  scheduled_at: string | null;
}

interface SpeakerRow {
  role: string;
  display_name: string;
}

interface TranscriptEntryRow {
  id: string;
  speaker_id: string | null;
  debate_time_mmss: string | null;
  text: string;
}

interface NoteRow {
  id: string;
  content: string;
  debate_time_mmss: string | null;
  is_edited: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/debates/[debateId]/notes/export
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
): Promise<Response> {
  const { debateId } = await params;

  // 1. Extract bearer token
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer) {
    return new Response('Missing token', { status: 401 });
  }

  // 2. Verify token → userId
  let userId: string;
  try {
    const payload = await verifyToken(bearer);
    const sub = payload.sub as string | undefined;
    if (!sub) throw new Error('No sub claim');
    userId = sub;
  } catch {
    return new Response('Invalid token', { status: 401 });
  }

  try {
    const pool = getPool();

    // 3. Fetch debate, speakers, transcript, and user's notes in parallel
    const [debateResult, speakersResult, transcriptResult, notesResult] = await Promise.all([
      pool.query<DebateRow>(
        `SELECT id, topic, scheduled_at
         FROM listening.debates
         WHERE id = $1`,
        [debateId],
      ),
      pool.query<SpeakerRow>(
        `SELECT role, display_name
         FROM listening.debate_speakers
         WHERE debate_id = $1`,
        [debateId],
      ),
      pool.query<TranscriptEntryRow>(
        `SELECT te.id, te.speaker_id, te.debate_time_mmss, te.text
         FROM listening.transcript_entries te
         WHERE te.debate_id = $1
         ORDER BY te.spoken_at ASC`,
        [debateId],
      ),
      pool.query<NoteRow>(
        `SELECT id, content, debate_time_mmss, is_edited
         FROM listening.notes
         WHERE debate_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [debateId, userId],
      ),
    ]);

    // 4. 404 if debate not found
    if (debateResult.rows.length === 0) {
      return new Response('Debate not found', { status: 404 });
    }

    const debate = debateResult.rows[0];
    const speakers = speakersResult.rows;
    const transcriptRows = transcriptResult.rows;
    const noteRows = notesResult.rows;

    // 5. Fetch exporter display name; fall back to 'You' on error
    let exporterName = 'You';
    try {
      const account = await getAccountMe(bearer);
      exporterName = account.display_name ?? 'You';
    } catch {
      // non-fatal — fall back silently
    }

    // 6. Build speaker lookup maps
    const speakersMap = new Map<string, SpeakerRow>();
    for (const s of speakers) {
      speakersMap.set(s.role, s);
    }

    // Role → label mapping
    const roleToLabel = (role: string): 'Aff' | 'Neg' | 'Mod' => {
      if (role === 'affirmative') return 'Aff';
      if (role === 'negative') return 'Neg';
      return 'Mod';
    };

    // Build speaker_id → speaker lookup (for transcript entries)
    // We use debate_speakers role + role-based label. Transcript entries have
    // speaker_id which refers to debate_speakers.id — use a separate query or
    // rely on the role mapping via speakersMap. Since we need speaker_id → role,
    // we fetch the full debate_speakers with id included.
    const speakersWithId = await pool.query<{ id: string; role: string; display_name: string }>(
      `SELECT id, role, display_name FROM listening.debate_speakers WHERE debate_id = $1`,
      [debateId],
    );
    const speakerById = new Map<string, { role: string; display_name: string }>();
    for (const s of speakersWithId.rows) {
      speakerById.set(s.id, { role: s.role, display_name: s.display_name });
    }

    // 7. Build transcript prop array
    const transcriptProp = transcriptRows
      .filter((te) => te.debate_time_mmss !== null)
      .map((te) => {
        const speaker = te.speaker_id ? speakerById.get(te.speaker_id) : undefined;
        const role = speaker?.role ?? 'moderator';
        return {
          id: te.id,
          debate_time_mmss: te.debate_time_mmss as string,
          speakerLabel: roleToLabel(role),
          speakerName: speaker?.display_name ?? 'Unknown Speaker',
          text: te.text,
        };
      });

    // 8. Build debate prop
    const aff = speakersMap.get('affirmative');
    const neg = speakersMap.get('negative');
    const mod = speakersMap.get('moderator');

    const debuteProp = {
      title: debate.topic,
      date: debate.scheduled_at
        ? debate.scheduled_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      affirmativeName: aff?.display_name ?? 'Affirmative Speaker',
      negativeName: neg?.display_name ?? 'Negative Speaker',
      moderatorName: mod?.display_name ?? 'Moderator',
    };

    // 9. Render PDF buffer.
    // DebateNotesPdf renders a <Document> root, which satisfies DocumentProps at
    // runtime.  The type cast bridges the gap between our component's prop type
    // and the narrower ReactElement<DocumentProps> expected by renderToBuffer.
    const element = React.createElement(DebateNotesPdf, {
      debate: debuteProp,
      exporterName,
      notes: noteRows,
      transcript: transcriptProp,
    }) as unknown as React.ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(element);

    // 10. Return PDF response
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="debate-notes-${debateId}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[notes-export]', err);
    return new Response('Export failed', { status: 500 });
  }
}
