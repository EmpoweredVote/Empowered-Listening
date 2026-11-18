'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useDebateStore, type DebateRow, type DebateSegmentRow, type DebateSpeakerRow } from '@/store/debateStore';
import { recordServerTime } from '@/lib/debate/clock';

interface Snapshot {
  debate: DebateRow;
  segments: DebateSegmentRow[];
  speakers: DebateSpeakerRow[];
  /** The server's clock at the moment it answered. Absent on older deploys. */
  server_now?: string;
}

/**
 * Keeps the Zustand store in step with the server for the length of a debate.
 *
 * Loads `/api/debates/[debateId]/snapshot` on mount, then reloads it whenever
 * the server broadcasts that the debate moved, on the channel `debate-{id}`.
 *
 * This used to subscribe to `postgres_changes` on debates, debate_segments and
 * debate_speakers. That channel reported SUBSCRIBED and then delivered
 * nothing — the same failure the transcript hit before it moved to broadcast.
 * The visible cost was that a speaker's store never learned the segment had
 * changed, so useMicAutoPublish kept evaluating against the previous segment
 * and both speakers had to reload the page at every transition before their
 * microphone would come on.
 *
 * A reload rather than a patched-in row: the mount path and the live path then
 * consume one shape, so a new column cannot leave one of them stale. There are
 * only a handful of transitions in a debate.
 */
export function useDebateSync(debateId: string): void {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    /** Guards against a slow earlier response overwriting a newer one. */
    let latestRequest = 0;

    async function loadSnapshot() {
      const seq = ++latestRequest;
      const ev = typeof window !== 'undefined' ? window.localStorage.getItem('ev_token') : null;
      // Timed either side of the request: this doubles as the clock sample
      // that keeps every participant's countdown on the server's clock.
      const requestStartedMs = Date.now();
      try {
        const res = await fetch(`/api/debates/${debateId}/snapshot`, {
          headers: ev ? { Authorization: `Bearer ${ev}` } : {},
          credentials: 'include',
          cache: 'no-store',
        });
        // Taken on headers, before the body is read, so body parsing time
        // does not widen the measured round trip.
        const responseReceivedMs = Date.now();
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Snapshot fetch failed (${res.status}): ${body || res.statusText}`);
        }
        const snapshot = (await res.json()) as Snapshot;
        if (snapshot.server_now) {
          // Recorded even for a superseded response: a clock sample is still
          // a valid measurement regardless of which snapshot wins.
          recordServerTime({
            requestStartedMs,
            responseReceivedMs,
            serverNowMs: new Date(snapshot.server_now).getTime(),
          });
        }
        // Out-of-order or unmounted: drop it rather than move the store backwards.
        if (cancelled || seq !== latestRequest) return;
        useDebateStore.getState().setInitialSnapshot(snapshot);
      } catch (err: unknown) {
        if (cancelled || seq !== latestRequest) return;
        const message = err instanceof Error ? err.message : 'Unknown snapshot error';
        // Surface, don't swallow — the UI subscribes to snapshotError.
        useDebateStore.getState().setSnapshotError(message);
      }
    }

    void loadSnapshot();

    const channel = supabase
      .channel(`debate-${debateId}`)
      .on('broadcast', { event: 'changed' }, () => {
        void loadSnapshot();
      })
      .subscribe((status, err) => {
        if (err) console.error('[supabase-rt][debate] channel error:', err);
        else console.log('[supabase-rt][debate] channel status:', status);
      });

    // Broadcast is fire-and-forget: a message sent while this tab was asleep,
    // backgrounded or briefly disconnected is simply gone. Re-reading on focus
    // means the worst case is a stale tab, not a tab stale forever.
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
