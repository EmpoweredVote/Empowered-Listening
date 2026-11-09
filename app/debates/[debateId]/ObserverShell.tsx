'use client';

import { useEffect, useState } from 'react';
import { useObserverDebateSync } from '@/hooks/useObserverDebateSync';
import DesktopLayout from './DesktopLayout';
import { MobileLayout } from './MobileLayout';

interface ObserverShellProps {
  debateId: string;
  initialStatus: 'live' | 'completed' | 'scheduled';
  initialPlaybackId: string | null;
  initialRecordingPending: boolean;
  topic: string;
}

interface StreamState {
  status: 'live' | 'completed' | 'scheduled';
  mux_playback_id: string | null;
  recording_pending: boolean;
}

export default function ObserverShell({
  debateId,
  initialStatus,
  initialPlaybackId,
  initialRecordingPending,
  topic,
}: ObserverShellProps) {
  // Wire the anon Realtime + snapshot hook — populates useDebateStore for SegmentTimeline
  useObserverDebateSync(debateId);

  const [stream, setStream] = useState<StreamState>({
    status: initialStatus,
    mux_playback_id: initialPlaybackId,
    recording_pending: initialRecordingPending,
  });

  // Poll /api/debates/[debateId]/stream (no auth headers — the endpoint is anonymous):
  // every 5s while scheduled, to pick up the live stream; every 15s while a
  // completed debate's recording is still being prepared by Mux.
  const pollMs =
    stream.status === 'scheduled' ? 5000
      : stream.status === 'completed' && stream.recording_pending && !stream.mux_playback_id ? 15000
        : null;

  useEffect(() => {
    if (pollMs === null) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/debates/${debateId}/stream`);
        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            mux_playback_id: string | null;
            recording_pending?: boolean;
          };
          const status = data.status as 'live' | 'completed' | 'scheduled';
          setStream({
            status,
            mux_playback_id: data.mux_playback_id,
            recording_pending: data.recording_pending ?? false,
          });
        }
      } catch {
        // Network error — continue polling on next interval
      }
    }, pollMs);

    return () => clearInterval(timer);
  }, [debateId, pollMs]);

  // Compute HLS URL: only when live/completed AND playback ID exists.
  // The server picks the right ID: the live stream while live, the recording once completed.
  const hlsUrl =
    (stream.status === 'live' || stream.status === 'completed') && stream.mux_playback_id
      ? `https://stream.mux.com/${stream.mux_playback_id}.m3u8`
      : null;

  // Text shown in the video area when there is nothing to play.
  const videoPlaceholder =
    stream.status === 'scheduled' ? 'Waiting for debate to start…'
      : stream.status === 'completed'
        ? stream.recording_pending
          ? 'The recording is processing. It will appear here shortly.'
          : 'No recording is available for this debate.'
        : 'Stream unavailable.';

  return (
    <>
      {/* Desktop layout — md+ screens */}
      <div className="hidden md:block h-screen bg-slate-950 text-slate-100">
        <DesktopLayout
          debateId={debateId}
          hlsUrl={hlsUrl}
          videoPlaceholder={videoPlaceholder}
          status={stream.status}
          topic={topic}
        />
      </div>

      {/* Mobile (< md) */}
      <div className="md:hidden h-screen">
        <MobileLayout
          debateId={debateId}
          hlsUrl={hlsUrl}
          videoPlaceholder={videoPlaceholder}
          status={stream.status}
          topic={topic}
        />
      </div>
    </>
  );
}
