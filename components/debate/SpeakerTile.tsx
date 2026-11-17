'use client';

import { useRemoteParticipants, useLocalParticipant, VideoTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';

interface SpeakerTileProps {
  expectedIdentity: string;
  displayName: string;
  /**
   * Which seat this tile is. Only the moderator gets manual controls: a
   * speaker's mic is on the segment schedule, driven by useMicAutoPublish, and
   * a manual toggle would be fighting it on the next transition.
   */
  role?: 'affirmative' | 'negative' | 'moderator';
}

export function SpeakerTile({ expectedIdentity, displayName, role }: SpeakerTileProps) {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();

  const isLocal = localParticipant?.identity === expectedIdentity;

  const participant: Participant | undefined = isLocal
    ? localParticipant
    : remoteParticipants.find(p => p.identity === expectedIdentity);

  const videoTracks = useTracks([Track.Source.Camera]).filter(
    t => t.participant.identity === expectedIdentity,
  );
  const videoRef = videoTracks[0];
  const micOn = participant?.isMicrophoneEnabled ?? false;
  const cameraOn = participant?.isCameraEnabled ?? false;

  // The moderator drives their own mic and camera by hand.
  const canToggle = isLocal && role === 'moderator' && !!localParticipant;

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

      <div className="absolute bottom-2 right-2 flex items-center gap-1">
        {canToggle && (
          <Pill
            on={cameraOn}
            onLabel="camera on"
            offLabel="camera off"
            title={cameraOn ? 'Turn your camera off' : 'Turn your camera on'}
            onClick={() => void localParticipant.setCameraEnabled(!cameraOn)}
          />
        )}
        <Pill
          on={micOn}
          onLabel="mic on"
          offLabel="mic off"
          title={canToggle ? (micOn ? 'Mute yourself' : 'Unmute yourself') : undefined}
          onClick={canToggle ? () => void localParticipant.setMicrophoneEnabled(!micOn) : undefined}
        />
      </div>
    </div>
  );
}

/**
 * The status pill. Static for everyone else, a button for the moderator's own
 * tile — the same shape either way, so the row does not jump when it becomes
 * interactive.
 */
function Pill({
  on,
  onLabel,
  offLabel,
  title,
  onClick,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  title?: string;
  onClick?: () => void;
}) {
  const label = on ? onLabel : offLabel;
  const colour = on ? 'bg-emerald-600' : 'bg-slate-700';
  const base = `rounded-full px-2 py-1 text-xs text-white ${colour}`;

  if (!onClick) {
    return (
      <span className={base} aria-label={label}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      aria-label={label}
      className={`${base} cursor-pointer transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}
    >
      {label}
    </button>
  );
}
