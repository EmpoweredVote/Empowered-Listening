'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useDebateStore, type DebateRow, type DebateSegmentRow, type DebateSpeakerRow } from '@/store/debateStore';

interface Snapshot {
  debate: DebateRow;
  segments: DebateSegmentRow[];
  speakers: DebateSpeakerRow[];
}

/**
 * useObserverDebateSync — anonymous twin of useDebateSync.
 *
 * Differences from useDebateSync:
 *  1. Fetches /api/debates/[debateId]/observer-snapshot — no Authorization header.
 *  2. Listens on `observer-debate-${debateId}`, distinct from the participant
 *     channel `debate-${debateId}`, so the two never collide in one browser.
 *
 * Populates the same useDebateStore as participants, so SegmentTimer,
 * SegmentTimeline and the rest behave identically on both surfaces.
 *
 * Like useDebateSync, this replaced a `postgres_changes` subscription that
 * reported SUBSCRIBED and delivered nothing. For observers the cost was an
 * entire page frozen at whatever state it loaded with: the segment never
 * advanced and the timer never moved on, so the live transcript scrolled on
 * underneath a heading for a segment that had finished minutes earlier.
 */
export function useObserverDebateSync(debateId: string): void {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    /** Guards against a slow earlier response overwriting a newer one. */
    let latestRequest = 0;

    async function loadSnapshot() {
      const seq = ++latestRequest;
      try {
        const res = await fetch(`/api/debates/${debateId}/observer-snapshot`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Observer snapshot fetch failed (${res.status}): ${body || res.statusText}`);
        }
        const snapshot = (await res.json()) as Snapshot;
        if (cancelled || seq !== latestRequest) return;
        useDebateStore.getState().setInitialSnapshot(snapshot);
      } catch (err: unknown) {
        if (cancelled || seq !== latestRequest) return;
        const message = err instanceof Error ? err.message : 'Unknown observer snapshot error';
        useDebateStore.getState().setSnapshotError(message);
      }
    }

    void loadSnapshot();

    const channel = supabase
      .channel(`observer-debate-${debateId}`)
      .on('broadcast', { event: 'changed' }, () => {
        void loadSnapshot();
      })
      .subscribe((status, err) => {
        if (err) console.error('[supabase-rt][observer] channel error:', err);
        else console.log('[supabase-rt][observer] channel status:', status);
      });

    // Observers leave a debate open in a background tab far more than
    // participants do, so the focus re-read matters more here.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadSnapshot();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
      useDebateStore.getState().reset();
    };
  }, [debateId]);
}
