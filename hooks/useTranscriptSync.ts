'use client';
import { useEffect, useCallback } from 'react';
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
  // Stable callbacks to avoid re-subscribing on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFinal = useCallback(onFinal, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInterim = useCallback(onInterim, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`transcript-${debateId}`)
      .on('broadcast', { event: 'final' }, (payload) => {
        stableFinal(payload.payload as FinalEntry);
      })
      .on('broadcast', { event: 'interim' }, (payload) => {
        stableInterim(payload.payload as InterimEntry);
      })
      .subscribe((status, err) => {
        if (err) {
          console.error('[supabase-rt][transcript] channel error:', err);
        } else {
          console.log('[supabase-rt][transcript] channel status:', status);
        }
      });

    return () => { void supabase.removeChannel(channel); };
  }, [debateId, stableFinal, stableInterim]);
}
