'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { ParticipantGrid, type DebateSpeakerInfo } from './ParticipantGrid';
import { WaitingRoom } from './WaitingRoom';
import { ModeratorPanel } from './ModeratorPanel';
import { SpeakerView } from './SpeakerView';
import { useDebateSync } from '@/hooks/useDebateSync';
import { useMicAutoPublish } from '@/hooks/useMicAutoPublish';
import { useDebateStore } from '@/store/debateStore';

interface DebateRoomProps {
  debateId: string;
  token: string;
  serverUrl: string;
  speakers: DebateSpeakerInfo[];
  /** true => this tab is the moderator's; render ModeratorPanel instead of SpeakerView */
  isModerator?: boolean;
}

function InnerRoom({ debateId, speakers, isModerator }: {
  debateId: string; speakers: DebateSpeakerInfo[]; isModerator: boolean;
}) {
  useMicAutoPublish();
  const waitingComplete = useDebateStore(s => (s.debate?.status ?? 'scheduled') === 'live');

  return (
    <div className="relative mx-auto max-w-6xl space-y-4 p-4">
      {isModerator && !waitingComplete && <WaitingRoom speakers={speakers} />}
      {/* SpeakerView has its own moderator-guard, so it's safe to render for
          all participants — it shows only for the active aff/neg speaker.
          Above the grid, not over it: centred on the grid it covered the
          middle tile, which is the moderator's. */}
      <SpeakerView />
      <ParticipantGrid speakers={speakers} />
      {isModerator && <ModeratorPanel debateId={debateId} />}

      {/* The notes panel, transcript and (for speakers) the rebuttal checklist
          all live on /debates/[debateId], not in this room.  Nothing linked
          there, so the only way to reach a speaker's own checklist was to be
          told the URL.  Opens in a new tab: leaving this one drops the LiveKit
          connection and the mic with it. */}
      <div className="flex justify-center pt-2">
        <a
          href={`/debates/${debateId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
        >
          Open transcript &amp; notes{isModerator ? '' : ' (rebuttal checklist)'} ↗
        </a>
      </div>
    </div>
  );
}

export function DebateRoom({ debateId, token, serverUrl, speakers, isModerator = false }: DebateRoomProps) {
  useDebateSync(debateId);
  return (
    <LiveKitRoom token={token} serverUrl={serverUrl} connect video data-lk-theme="default" className="min-h-screen bg-slate-950">
      <RoomAudioRenderer />
      <InnerRoom debateId={debateId} speakers={speakers} isModerator={isModerator} />
    </LiveKitRoom>
  );
}
