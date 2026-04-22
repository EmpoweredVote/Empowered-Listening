'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useDebateStore, type DebateRow, type DebateSegmentRow, type DebateSpeakerRow } from '@/store/debateStore';

/**
 * Subscribes the Zustand store to postgres_changes for:
 *   - listening.debates
 *   - listening.debate_segments
 *   - listening.debate_speakers
 * filtered by debate_id = <debateId>.
 *
 * Also fetches an initial snapshot via /api/debates/[debateId]/snapshot so the store
 * is populated before Realtime fires.  Realtime postgres_changes does not replay
 * existing rows — the initial snapshot is required.
 *
 * Fetch errors are exposed via useDebateStore.snapshotError (NOT silently swallowed)
 * so the UI can show a retry/error state.
 */
export function useDebateSync(debateId: string): void {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    // --- Initial snapshot ---
    const ev = typeof window !== 'undefined' ? window.localStorage.getItem('ev_token') : null;
    fetch(`/api/debates/${debateId}/snapshot`, {
      headers: ev ? { Authorization: `Bearer ${ev}` } : {},
      credentials: 'include',
    })
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          throw new Error(`Snapshot fetch failed (${r.status}): ${body || r.statusText}`);
        }
        return r.json() as Promise<{ debate: DebateRow; segments: DebateSegmentRow[]; speakers: DebateSpeakerRow[] }>;
      })
      .then(snapshot => {
        if (cancelled) return;
        useDebateStore.getState().setInitialSnapshot(snapshot);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown snapshot error';
        // Surface, don't swallow — UI can subscribe to snapshotError for retry banner.
        useDebateStore.getState().setSnapshotError(message);
      });

    // --- Realtime subscription ---
    const channel = supabase
      .channel(`debate-${debateId}`)
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
        console.log('[supabase-rt] channel status:', status, err ?? '');
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      useDebateStore.getState().reset();
    };
  }, [debateId]);
}
