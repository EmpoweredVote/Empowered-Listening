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

      if (shouldHaveMic && !localParticipant.isMicrophoneEnabled) {
        void localParticipant.setMicrophoneEnabled(true);
      } else if (!shouldHaveMic && localParticipant.isMicrophoneEnabled) {
        void localParticipant.setMicrophoneEnabled(false);
      }
    };

    check();
    localParticipant.on('participantPermissionsChanged', check);
    return () => { localParticipant.off('participantPermissionsChanged', check); };
  }, [localParticipant, active, speakers]);
}
