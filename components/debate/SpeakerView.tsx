'use client';

import { useDebateStore } from '@/store/debateStore';
import { LD_SEGMENTS } from '@/lib/debate/segments';
import { SegmentTimer } from './SegmentTimer';
import { useLocalParticipant } from '@livekit/components-react';

/**
 * Renders a big overlay with [abbreviation] + [display name] + [large SegmentTimer] when the
 * local participant is the active speaker for the current segment.
 *
 * Moderators never see this overlay, including during CX.  The guard
 * localSpeaker.role !== 'moderator' is evaluated BEFORE matching activeSpeakerRole,
 * so activeSpeakerRole='both' only applies to affirmative/negative speakers.
 */
export function SpeakerView() {
  const { localParticipant } = useLocalParticipant();
  const active = useDebateStore(s => s.getActiveSegment());
  const speakers = useDebateStore(s => s.speakers);

  if (!active || !localParticipant) return null;

  const activeMeta = LD_SEGMENTS.find(m => m.segmentType === active.segment_type);
  if (!activeMeta) return null;

  const localIdentity = localParticipant.identity;
  const localSpeaker = Object.values(speakers).find(s => s.livekit_identity === localIdentity);
  if (!localSpeaker) return null;

  // Explicit moderator exclusion.  Without this guard,
  // activeSpeakerRole='both' during CX would match the moderator's tab too.
  const isActiveSpeaker =
    localSpeaker.role !== 'moderator' && (
      activeMeta.activeSpeakerRole === 'both' ||
      (activeMeta.activeSpeakerRole === 'affirmative' && localSpeaker.role === 'affirmative') ||
      (activeMeta.activeSpeakerRole === 'negative' && localSpeaker.role === 'negative')
    );

  if (!isActiveSpeaker) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex flex-col items-center gap-2">
      <div className="rounded bg-black/80 px-4 py-1 text-sm uppercase tracking-widest text-white">
        {activeMeta.abbreviation} — {activeMeta.displayName}
      </div>
      <SegmentTimer className="text-6xl" />
    </div>
  );
}
