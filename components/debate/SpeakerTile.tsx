'use client';

import { useRemoteParticipants, useLocalParticipant, VideoTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';

interface SpeakerTileProps {
  expectedIdentity: string;
  displayName: string;
}

export function SpeakerTile({ expectedIdentity, displayName }: SpeakerTileProps) {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();

  const participant: Participant | undefined =
    localParticipant?.identity === expectedIdentity
      ? localParticipant
      : remoteParticipants.find(p => p.identity === expectedIdentity);

  const videoTracks = useTracks([Track.Source.Camera]).filter(
    t => t.participant.identity === expectedIdentity,
  );
  const videoRef = videoTracks[0];
  const micOn = participant?.isMicrophoneEnabled ?? false;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
      {videoRef ? (
        <VideoTrack trackRef={videoRef} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {participant ? 'Camera off' : 'Waiting...'}
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-sm text-white">
        {displayName}
      </div>
      <div
        className={`absolute bottom-2 right-2 rounded-full px-2 py-1 text-xs text-white ${
          micOn ? 'bg-emerald-600' : 'bg-slate-700'
        }`}
        aria-label={micOn ? 'Microphone on' : 'Microphone off'}
      >
        {micOn ? 'mic on' : 'mic off'}
      </div>
    </div>
  );
}
