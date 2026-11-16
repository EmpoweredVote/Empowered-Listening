'use client';

interface TranscriptEntryProps {
  entry: {
    /**
     * The row's database id, when it has one. Entries arriving over the
     * broadcast channel are given a synthetic `${speakerId}-${spokenAt}` id by
     * TranscriptPanel; those are not UUIDs, so they are deliberately not
     * exposed as an anchor (see `isUuid` below).
     */
    id?: string;
    speakerId: string;
    text: string;
    spokenAt: string;
    debateTimeMmss: string;
  };
  speaker: {
    displayName: string;
    role: 'affirmative' | 'negative' | 'moderator';
  } | undefined;
}

const ROLE_LABELS: Record<'affirmative' | 'negative' | 'moderator', string> = {
  affirmative: 'Aff',
  negative: 'Neg',
  moderator: 'Mod',
};

const ROLE_COLORS: Record<'affirmative' | 'negative' | 'moderator', string> = {
  affirmative: 'text-blue-400',
  negative: 'text-amber-400',
  moderator: 'text-slate-400',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only a real row id may become a rebuttal note's anchor:
 * `notes.source_transcript_entry_id` is a uuid with a foreign key to
 * `transcript_entries(id)`, and the notes POST schema validates `.uuid()`.
 * A synthetic broadcast id would fail both.
 */
function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * TranscriptEntry — renders a single finalized transcript entry.
 *
 * Layout:
 *   [mm:ss]  Name · Role   (speaker label, color-coded by role)
 *   Body text...           (neutral slate-100)
 *
 * Carries `data-transcript-entry-id` when the entry has a persisted id, so
 * TranscriptSelectionPopup can anchor a speaker's rebuttal note to this line.
 */
export function TranscriptEntry({ entry, speaker }: TranscriptEntryProps) {
  const role = speaker?.role ?? 'moderator';
  const roleLabel = ROLE_LABELS[role];
  const labelColor = speaker ? ROLE_COLORS[role] : 'text-slate-400';
  const displayName = speaker?.displayName ?? 'Unknown';

  return (
    <div
      className="px-3 py-2 space-y-0.5"
      {...(isUuid(entry.id) ? { 'data-transcript-entry-id': entry.id } : {})}
    >
      <div className={`text-xs font-medium ${labelColor}`}>
        {entry.debateTimeMmss}&nbsp;&nbsp;{displayName} · {roleLabel}
      </div>
      <p className="text-sm text-slate-100 leading-snug">{entry.text}</p>
    </div>
  );
}
