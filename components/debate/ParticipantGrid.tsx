'use client';

import { SpeakerTile } from './SpeakerTile';

export interface DebateSpeakerInfo {
  id: string;
  role: 'affirmative' | 'negative' | 'moderator';
  displayName: string;
  livekitIdentity: string;
}

interface ParticipantGridProps {
  speakers: DebateSpeakerInfo[];
}

export function ParticipantGrid({ speakers }: ParticipantGridProps) {
  const byRole = Object.fromEntries(speakers.map(s => [s.role, s])) as Record<
    'affirmative' | 'negative' | 'moderator',
    DebateSpeakerInfo
  >;
  // Layout: affirmative | moderator | negative
  const ordered = [byRole.affirmative, byRole.moderator, byRole.negative].filter(Boolean);

  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      {ordered.map(s => (
        <SpeakerTile key={s.id} expectedIdentity={s.livekitIdentity} displayName={s.displayName} />
      ))}
    </div>
  );
}
