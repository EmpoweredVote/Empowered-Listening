import { notFound, redirect } from 'next/navigation';
import { getPool } from '@/lib/db/pool';
import { TranscriptEditor } from '@/components/transcript/moderator/TranscriptEditor';

interface TranscriptEntryRow {
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

interface DebateRow {
  id: string;
  status: string;
}

interface ModeratorRow {
  display_name: string;
  user_id: string;
}

export default async function ModeratorTranscriptPage({
  params,
}: {
  params: Promise<{ debateId: string }>;
}) {
  const { debateId } = await params;
  const pool = getPool();

  // Load debate status — redirect to /moderator/{debateId} if not completed
  const debateResult = await pool.query<DebateRow>(
    `SELECT id, status FROM listening.debates WHERE id = $1`,
    [debateId],
  );

  if (debateResult.rows.length === 0) notFound();

  const debate = debateResult.rows[0];
  if (debate.status !== 'completed') {
    redirect(`/moderator/${debateId}`);
  }

  // Load all transcript entries with speaker info
  const entriesResult = await pool.query<TranscriptEntryRow>(
    `SELECT
       te.id,
       te.debate_id,
       te.speaker_id,
       te.spoken_at,
       te.debate_time_mmss,
       te.text,
       te.original_text,
       te.edited,
       te.edited_at,
       te.edited_by,
       ds.display_name,
       ds.role AS speaker_role
     FROM listening.transcript_entries te
     LEFT JOIN listening.debate_speakers ds ON ds.id = te.speaker_id
     WHERE te.debate_id = $1
     ORDER BY te.spoken_at ASC`,
    [debateId],
  );

  // Load moderator's display name for "Edited by" attribution
  const moderatorResult = await pool.query<ModeratorRow>(
    `SELECT display_name, user_id
     FROM listening.debate_speakers
     WHERE debate_id = $1 AND role = 'moderator'
     LIMIT 1`,
    [debateId],
  );

  const moderatorName = moderatorResult.rows[0]?.display_name ?? 'Moderator';
  const entries = entriesResult.rows;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Transcript Review</h1>
        <p className="text-slate-400 text-sm mt-1">
          Click any entry to edit.  Originals are preserved.
        </p>
        <a
          href={`/moderator/${debateId}`}
          className="text-blue-400 text-sm hover:underline mt-2 inline-block"
        >
          &larr; Back to debate
        </a>
      </header>

      <div className="max-w-3xl mx-auto">
        {entries.length === 0 ? (
          <p className="text-slate-500">No transcript entries found for this debate.</p>
        ) : (
          <div className="space-y-0 divide-y divide-slate-800">
            {entries.map(entry => {
              const speaker =
                entry.display_name && entry.speaker_role
                  ? { displayName: entry.display_name, role: entry.speaker_role }
                  : undefined;

              return (
                <TranscriptEditor
                  key={entry.id}
                  entry={{
                    id: entry.id,
                    debate_id: entry.debate_id,
                    speaker_id: entry.speaker_id,
                    spoken_at: entry.spoken_at,
                    debate_time_mmss: entry.debate_time_mmss,
                    text: entry.text,
                    original_text: entry.original_text,
                    edited: entry.edited,
                    edited_at: entry.edited_at,
                    edited_by: entry.edited_by,
                  }}
                  speaker={speaker}
                  editorName={moderatorName}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
