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
      <div className="relative">
        <ParticipantGrid speakers={speakers} />
        {/* SpeakerView has its own moderator-guard, so it's safe to render
            for all participants — it will only show the overlay for active aff/neg speakers. */}
        <SpeakerView />
      </div>
      {isModerator && <ModeratorPanel debateId={debateId} />}
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
