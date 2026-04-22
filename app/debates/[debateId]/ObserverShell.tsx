'use client';

import { useEffect, useState } from 'react';
import { useObserverDebateSync } from '@/hooks/useObserverDebateSync';
import DesktopLayout from './DesktopLayout';

interface ObserverShellProps {
  debateId: string;
  initialStatus: 'live' | 'completed' | 'scheduled';
  initialPlaybackId: string | null;
  topic: string;
}

interface StreamState {
  status: 'live' | 'completed' | 'scheduled';
  mux_playback_id: string | null;
}

export default function ObserverShell({
  debateId,
  initialStatus,
  initialPlaybackId,
  topic,
}: ObserverShellProps) {
  // Wire the anon Realtime + snapshot hook — populates useDebateStore for SegmentTimeline
  useObserverDebateSync(debateId);

  const [stream, setStream] = useState<StreamState>({
    status: initialStatus,
    mux_playback_id: initialPlaybackId,
  });

  // Poll /api/debates/[debateId]/stream every 5s while scheduled
  // (no auth headers — stream endpoint is anonymous)
  useEffect(() => {
    if (stream.status !== 'scheduled') return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/debates/${debateId}/stream`);
        if (res.ok) {
          const data = (await res.json()) as { status: string; mux_playback_id: string | null };
          const status = data.status as 'live' | 'completed' | 'scheduled';
          setStream({ status, mux_playback_id: data.mux_playback_id });
        }
      } catch {
        // Network error — continue polling on next interval
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [debateId, stream.status]);

  // Compute HLS URL: only when live/completed AND playback ID exists
  const hlsUrl =
    (stream.status === 'live' || stream.status === 'completed') && stream.mux_playback_id
      ? `https://stream.mux.com/${stream.mux_playback_id}.m3u8`
      : null;

  return (
    <>
      {/* Desktop layout — md+ screens */}
      <div className="hidden md:block h-screen bg-slate-950 text-slate-100">
        <DesktopLayout hlsUrl={hlsUrl} status={stream.status} topic={topic} />
      </div>

      {/* Mobile fallback — below md */}
      {/* 03-05 swaps this entire block out */}
      <div className="md:hidden min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-lg font-medium text-slate-200 mb-3">Desktop required</p>
          <p className="text-sm text-slate-400">
            Open this page on a desktop browser for the full experience.
          </p>
        </div>
      </div>
    </>
  );
}
