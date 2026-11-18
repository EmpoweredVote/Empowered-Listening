'use client';

import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useDebateStore } from '@/store/debateStore';
import { LD_SEGMENTS } from '@/lib/debate/segments';

/**
 * Enables/disables the local mic based on debate state in the Zustand store.
 *
 * Two triggers:
 *   1. Store change (active segment or speakers update) — primary path.
 *   2. LiveKit participantPermissionsChanged — handles the race where the store
 *      update arrives before canPublishSources is updated on the LiveKit server.
 *      When the permission change arrives, we re-evaluate and retry setMicrophoneEnabled.
 */
export function useMicAutoPublish(): void {
  const { localParticipant } = useLocalParticipant();
  const active = useDebateStore(s => s.getActiveSegment());
  const speakers = useDebateStore(s => s.speakers);

  useEffect(() => {
    if (!localParticipant) return;

    const check = () => {
      const localSpeaker = Object.values(speakers).find(
        s => s.livekit_identity === localParticipant.identity,
      );
      if (!localSpeaker || localSpeaker.role === 'moderator') return;

      const meta = active ? LD_SEGMENTS.find(s => s.segmentType === active.segment_type) : null;
      const shouldHaveMic =
        active?.status === 'active' &&
        !!meta &&
        (meta.activeSpeakerRole === 'both' ||
          (meta.activeSpeakerRole === 'affirmative' && localSpeaker.role === 'affirmative') ||
          (meta.activeSpeakerRole === 'negative' && localSpeaker.role === 'negative'));

      // Failures were silently dropped by `void`. A refused microphone is the
      // single most visible thing that can go wrong for a speaker, and it used
      // to leave no trace anywhere to find it by.
      if (shouldHaveMic && !localParticipant.isMicrophoneEnabled) {
        localParticipant.setMicrophoneEnabled(true).catch((err: unknown) => {
          console.error('[mic] enabling the microphone failed:', err);
        });
      } else if (!shouldHaveMic && localParticipant.isMicrophoneEnabled) {
        localParticipant.setMicrophoneEnabled(false).catch((err: unknown) => {
          console.error('[mic] disabling the microphone failed:', err);
        });
      }
    };

    check();
    localParticipant.on('participantPermissionsChanged', check);
    return () => { localParticipant.off('participantPermissionsChanged', check); };
  }, [localParticipant, active, speakers]);
}
