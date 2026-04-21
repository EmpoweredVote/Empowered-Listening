'use client';

import { useEffect, useRef } from 'react';
import { useDebateStore } from '@/store/debateStore';

/**
 * When the active segment's main timer reaches 0 AND the active speaker has
 * bonus_time_seconds <= 0 (or the segment has no speaker_id), POST the end-segment
 * action.  This only runs on the moderator's tab — a single client should drive
 * auto-expire to avoid duplicate calls.
 *
 * When the speaker DOES have bonus time remaining, BonusTimeDisplay handles the
 * client-computed countdown and fires end-segment itself on exhaustion.  This hook
 * is the complement: it covers the "no bonus available" case and CX/moderator-free
 * segments.
 *
 * `enabled` must be true ONLY for the moderator participant.
 */
export function useSegmentAutoExpire(debateId: string, enabled: boolean): void {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => {
      const active = useDebateStore.getState().getActiveSegment();
      if (!active || active.status !== 'active') return;
      const remaining = useDebateStore.getState().computeRemainingMs();
      if (remaining > 0) return;

      // Main hit 0 — check if BonusTimeDisplay would take over
      const speakerId = active.speaker_id;
      if (speakerId) {
        const speaker = useDebateStore.getState().speakers[speakerId];
        if (speaker && speaker.bonus_time_seconds > 0) return; // BonusTimeDisplay drives expiration
      }

      // Fire once per segment
      if (firedRef.current.has(active.id)) return;
      firedRef.current.add(active.id);

      const token = localStorage.getItem('ev_token');
      void fetch(`/api/debates/${debateId}/segments/${active.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'end' }),
      });
    }, 250);
    return () => clearInterval(iv);
  }, [debateId, enabled]);
}
