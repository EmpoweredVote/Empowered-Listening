'use client';

interface TranscriptEntryProps {
  entry: {
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

/**
 * TranscriptEntry — renders a single finalized transcript entry.
 *
 * Layout:
 *   [mm:ss]  Name · Role   (speaker label, color-coded by role)
 *   Body text...           (neutral slate-100)
 */
export function TranscriptEntry({ entry, speaker }: TranscriptEntryProps) {
  const role = speaker?.role ?? 'moderator';
  const roleLabel = ROLE_LABELS[role];
  const labelColor = speaker ? ROLE_COLORS[role] : 'text-slate-400';
  const displayName = speaker?.displayName ?? 'Unknown';

  return (
    <div className="px-3 py-2 space-y-0.5">
      <div className={`text-xs font-medium ${labelColor}`}>
        {entry.debateTimeMmss}&nbsp;&nbsp;{displayName} · {roleLabel}
      </div>
      <p className="text-sm text-slate-100 leading-snug">{entry.text}</p>
    </div>
  );
}
