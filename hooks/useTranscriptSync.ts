'use client';
import { useEffect, useRef } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export interface FinalEntry {
  speakerId: string;
  text: string;
  spokenAt: string;         // ISO timestamp string
  debateTimeMmss: string;
}

export interface InterimEntry {
  speakerId: string;
  text: string;
}

/**
 * useTranscriptSync — subscribes to the Supabase Realtime broadcast channel
 * `transcript-{debateId}` for live transcript updates.
 *
 * IMPORTANT: Broadcast is EPHEMERAL — messages sent before subscription are lost.
 * Callers (TranscriptPanel) must load the DB snapshot via GET /api/debates/[id]/transcript
 * BEFORE calling this hook to avoid missing entries produced before the subscription
 * was established.
 *
 * Fires onFinal when a transcript entry is finalized (persisted to DB).
 * Fires onInterim when a partial/interim result is available (ephemeral, not persisted).
 */
export function useTranscriptSync(
  debateId: string,
  onFinal: (entry: FinalEntry) => void,
  onInterim: (entry: InterimEntry) => void,
): void {
  // Latest callbacks live in refs so the channel is not re-subscribed on every render.
  const finalRef = useRef(onFinal);
  const interimRef = useRef(onInterim);
  useEffect(() => {
    finalRef.current = onFinal;
    interimRef.current = onInterim;
  });

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`transcript-${debateId}`)
      .on('broadcast', { event: 'final' }, (payload) => {
        finalRef.current(payload.payload as FinalEntry);
      })
      .on('broadcast', { event: 'interim' }, (payload) => {
        interimRef.current(payload.payload as InterimEntry);
      })
      .subscribe((status, err) => {
        if (err) {
          console.error('[supabase-rt][transcript] channel error:', err);
        } else {
          console.log('[supabase-rt][transcript] channel status:', status);
        }
      });

    return () => { void supabase.removeChannel(channel); };
  }, [debateId]);
}
