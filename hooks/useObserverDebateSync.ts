'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useDebateStore, type DebateRow, type DebateSegmentRow, type DebateSpeakerRow } from '@/store/debateStore';

/**
 * useObserverDebateSync — anonymous twin of useDebateSync.
 *
 * Differences from useDebateSync:
 *  1. Fetches from /api/debates/[debateId]/observer-snapshot — no Authorization header.
 *  2. Does NOT call supabase.realtime.setAuth() — anon key is sufficient because the
 *     RLS policies for listening.debate_segments, debate_speakers, and debates all include
 *     the `anon` role (see migration 20260421000002_fix_realtime_rls_anon.sql).
 *  3. Uses channel name `observer-debate-${debateId}` (distinct from participant channel
 *     `debate-${debateId}`) to avoid collision when both run in the same browser session.
 *
 * Populates the same useDebateStore used by all downstream components (SegmentTimer,
 * SegmentTimeline, etc.) so they work identically for observers and participants.
 */
export function useObserverDebateSync(debateId: string): void {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    // --- Initial snapshot (no auth header) ---
    fetch(`/api/debates/${debateId}/observer-snapshot`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          throw new Error(`Observer snapshot fetch failed (${r.status}): ${body || r.statusText}`);
        }
        return r.json() as Promise<{ debate: DebateRow; segments: DebateSegmentRow[]; speakers: DebateSpeakerRow[] }>;
      })
      .then(snapshot => {
        if (cancelled) return;
        useDebateStore.getState().setInitialSnapshot(snapshot);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown observer snapshot error';
        useDebateStore.getState().setSnapshotError(message);
      });

    // --- Realtime subscription (anon key, no setAuth needed) ---
    // RLS on all three tables grants SELECT to authenticated AND anon roles.
    // Supabase Realtime evaluates the anon JWT automatically when no setAuth is called.
    const channel = supabase
      .channel(`observer-debate-${debateId}`)
      .on('postgres_changes',
        { event: '*', schema: 'listening', table: 'debate_segments', filter: `debate_id=eq.${debateId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          useDebateStore.getState().applySegmentUpdate(payload.new as DebateSegmentRow);
        })
      .on('postgres_changes',
        { event: '*', schema: 'listening', table: 'debate_speakers', filter: `debate_id=eq.${debateId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          useDebateStore.getState().applySpeakerUpdate(payload.new as DebateSpeakerRow);
        })
      .on('postgres_changes',
        { event: '*', schema: 'listening', table: 'debates', filter: `id=eq.${debateId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          useDebateStore.getState().applyDebateUpdate(payload.new as DebateRow);
        })
      .subscribe((status, err) => {
        console.log('[supabase-rt][observer] channel status:', status, err ?? '');
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      useDebateStore.getState().reset();
    };
  }, [debateId]);
}
