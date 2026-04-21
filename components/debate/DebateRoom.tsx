'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { ParticipantGrid, type DebateSpeakerInfo } from './ParticipantGrid';
import { WaitingRoom } from './WaitingRoom';

interface DebateRoomProps {
  token: string;
  serverUrl: string;
  speakers: DebateSpeakerInfo[];
  showWaitingRoom?: boolean;
}

export function DebateRoom({ token, serverUrl, speakers, showWaitingRoom = false }: DebateRoomProps) {
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
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        {showWaitingRoom && <WaitingRoom speakers={speakers} />}
        <ParticipantGrid speakers={speakers} />
      </div>
    </LiveKitRoom>
  );
}
