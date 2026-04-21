'use client';

import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useDebateStore } from '@/store/debateStore';
import { LD_SEGMENTS } from '@/lib/debate/segments';

/**
 * Enables/disables the local mic based on debate state in the Zustand store.
 * Reacts to segment changes via Realtime — no LiveKit permission event needed.
 *
 * Moderators: never get a mic (their token has canPublish: false at mint time).
 * Speakers: mic on only when they are the active speaker for the current segment.
 * Between segments (no active segment): mic off.
 */
export function useMicAutoPublish(): void {
  const { localParticipant } = useLocalParticipant();
  const active = useDebateStore(s => s.getActiveSegment());
  const speakers = useDebateStore(s => s.speakers);

  useEffect(() => {
    if (!localParticipant) return;

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
  }, [localParticipant, active, speakers]);
}
