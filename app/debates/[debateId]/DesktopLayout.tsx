'use client';

import { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import HlsPlayer from './HlsPlayer';
import { SegmentTimeline } from './SegmentTimeline';
import { TranscriptPanel } from '@/components/transcript/TranscriptPanel';
import { useDebateStore } from '@/store/debateStore';
import { LD_SEGMENTS } from '@/lib/debate/segments';

interface DesktopLayoutProps {
  debateId: string;
  hlsUrl: string | null;
  status: 'live' | 'completed' | 'scheduled';
  topic: string | null;
}

// Map segment_type to display name from canonical LD_SEGMENTS list
const SEGMENT_DISPLAY_NAME = Object.fromEntries(
  LD_SEGMENTS.map(s => [s.segmentType, s.displayName]),
);

export default function DesktopLayout({ debateId, hlsUrl, status, topic }: DesktopLayoutProps) {
  // SSR hydration guard — react-resizable-panels reads localStorage for sizes.
  // Rendering a skeleton on first pass prevents hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Build speakers map and segments array from debate store for TranscriptPanel
  const storeSpeakers = useDebateStore(s => s.speakers);
  const storeSegments = useDebateStore(s => s.segments);

  const speakersMap = Object.fromEntries(
    Object.values(storeSpeakers).map(s => [
      s.id,
      {
        displayName: s.display_name,
        role: s.role as 'affirmative' | 'negative' | 'moderator',
      },
    ]),
  );

  const segmentsArray = Object.values(storeSegments)
    .sort((a, b) => a.sequence_order - b.sequence_order)
    .map(s => ({
      id: s.id,
      name: SEGMENT_DISPLAY_NAME[s.segment_type] ?? s.segment_type,
      actual_start: s.actual_start,
      allocated_seconds: s.allocated_seconds,
    }));

  // Panel size persistence via useDefaultLayout hook (v4 replacement for autoSaveId prop)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'observer-desktop-layout-v1',
  });

  // Refs for keyboard shortcuts
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const transcriptPanelRef = useRef<HTMLDivElement>(null);
  const notesPanelRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut handler
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Guard: skip when user is typing in an input or editable element
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case ' ': {
          e.preventDefault(); // REQUIRED — Space scrolls page without this
          const video = videoContainerRef.current?.querySelector('video');
          if (video) {
            if (video.paused) {
              void video.play();
            } else {
              video.pause();
            }
          }
          break;
        }
        case 't':
        case 'T':
          transcriptPanelRef.current?.focus();
          break;
        case 'n':
        case 'N':
          notesPanelRef.current?.focus();
          break;
        case 'f':
        case 'F':
          void videoContainerRef.current?.requestFullscreen();
          break;
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  if (!mounted) {
    return <div className="h-screen bg-slate-950" />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Header: debate topic + segment timeline */}
      <header className="shrink-0 px-4 py-2 border-b border-slate-800 bg-slate-950">
        <h1 className="text-sm font-semibold text-slate-200 truncate mb-1">
          {topic ?? 'Debate'}
        </h1>
        <SegmentTimeline variant="desktop" />
      </header>

      {/* Three-panel resizable layout */}
      <Group
        orientation="horizontal"
        className="flex-1 min-h-0"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {/* Video panel */}
        <Panel defaultSize={60} minSize={35}>
          <div
            ref={videoContainerRef}
            className="relative h-full w-full bg-black"
          >
            {hlsUrl ? (
              <HlsPlayer
                src={hlsUrl}
                badgeLabel={status === 'completed' ? 'Recorded' : undefined}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                {status === 'scheduled'
                  ? 'Waiting for debate to start…'
                  : 'Stream unavailable.'}
              </div>
            )}
          </div>
        </Panel>

        <Separator className="w-1 cursor-col-resize bg-slate-800 hover:bg-blue-600 transition-colors" />

        {/* Transcript panel */}
        <Panel defaultSize={25} minSize={15}>
          <div
            ref={transcriptPanelRef}
            tabIndex={0}
            role="region"
            aria-label="Transcript panel"
            className="h-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <TranscriptPanel
              debateId={debateId}
              speakers={speakersMap}
              segments={segmentsArray}
            />
          </div>
        </Panel>

        <Separator className="w-1 cursor-col-resize bg-slate-800 hover:bg-blue-600 transition-colors" />

        {/* Notes panel — Phase 5 placeholder */}
        <Panel defaultSize={15} minSize={10}>
          <div
            ref={notesPanelRef}
            tabIndex={0}
            role="region"
            aria-label="Notes panel"
            className="h-full overflow-y-auto p-4 text-sm text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Notes &mdash; available in a future update (Phase 5).
          </div>
        </Panel>
      </Group>

      {/* Footer: keyboard shortcut hints */}
      <footer className="shrink-0 border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
        Shortcuts: Space play/pause &middot; T transcript &middot; N notes &middot; F fullscreen
      </footer>
    </div>
  );
}
