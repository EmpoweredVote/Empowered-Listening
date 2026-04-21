'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { ParticipantGrid, type DebateSpeakerInfo } from './ParticipantGrid';
import { WaitingRoom } from './WaitingRoom';
import { useDebateSync } from '@/hooks/useDebateSync';
import { useMicAutoPublish } from '@/hooks/useMicAutoPublish';

interface DebateRoomProps {
  debateId: string;
  token: string;
  serverUrl: string;
  speakers: DebateSpeakerInfo[];
  showWaitingRoom?: boolean;
}

function InnerRoom({ speakers, showWaitingRoom }: { speakers: DebateSpeakerInfo[]; showWaitingRoom: boolean }) {
  useMicAutoPublish();
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {showWaitingRoom && <WaitingRoom speakers={speakers} />}
      <ParticipantGrid speakers={speakers} />
    </div>
  );
}

export function DebateRoom({ debateId, token, serverUrl, speakers, showWaitingRoom = false }: DebateRoomProps) {
  useDebateSync(debateId);

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={true}
      audio={true}
      data-lk-theme="default"
      className="min-h-screen bg-slate-950"
    >
      <RoomAudioRenderer />
      <InnerRoom speakers={speakers} showWaitingRoom={showWaitingRoom} />
    </LiveKitRoom>
  );
}
