'use client';

import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import type { DebateSpeakerInfo } from './ParticipantGrid';

interface WaitingRoomProps {
  speakers: DebateSpeakerInfo[];
}

export function WaitingRoom({ speakers }: WaitingRoomProps) {
  const remotes = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();

  const connectedIdentities = new Set<string>([
    ...(localParticipant ? [localParticipant.identity] : []),
    ...remotes.map(p => p.identity),
  ]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Waiting for participants</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {speakers.map(s => (
          <li key={s.id} className="flex justify-between">
            <span>
              {s.displayName}{' '}
              <span className="text-slate-400">({s.role})</span>
            </span>
            <span
              className={
                connectedIdentities.has(s.livekitIdentity)
                  ? 'text-emerald-700'
                  : 'text-slate-400'
              }
            >
              {connectedIdentities.has(s.livekitIdentity) ? 'Connected' : 'Waiting...'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
