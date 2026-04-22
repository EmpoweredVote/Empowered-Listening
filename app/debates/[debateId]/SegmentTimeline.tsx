'use client';

import { useEffect, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';
import { LD_SEGMENTS, getSegmentBySequence, type LDSegmentType } from '@/lib/debate/segments';

// Map segment type to abbreviation from the canonical LD_SEGMENTS list
const SEGMENT_ABBREV: Record<LDSegmentType, string> = Object.fromEntries(
  LD_SEGMENTS.map(s => [s.segmentType, s.abbreviation]),
) as Record<LDSegmentType, string>;

// Map segment type to full display name from the canonical LD_SEGMENTS list
const SEGMENT_DISPLAY_NAME: Record<LDSegmentType, string> = Object.fromEntries(
  LD_SEGMENTS.map(s => [s.segmentType, s.displayName]),
) as Record<LDSegmentType, string>;

interface SegmentTimelineProps {
  className?: string;
  variant?: 'desktop' | 'mobile';
}

/**
 * SegmentTimeline — reads useDebateStore and renders the 7 Lincoln-Douglas segments
 * as a row of pills.  Highlights the active segment with a 1-Hz progress fill.
 *
 * Callers (ObserverShell, DesktopLayout, MobileLayout) are responsible for invoking
 * useObserverDebateSync or useDebateSync before rendering this component.
 *
 * This component does NOT call useObserverDebateSync itself — it is a pure reader
 * of the shared Zustand store.
 */
export function SegmentTimeline({ className = '', variant = 'desktop' }: SegmentTimelineProps) {
  // Subscribe to store slices — re-renders when these change via Realtime
  const segments = useDebateStore(s =>
    Object.values(s.segments).sort((a, b) => a.sequence_order - b.sequence_order),
  );
  const speakers = useDebateStore(s => s.speakers);

  // 1-Hz tick drives progress fill on the active segment
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Derive active segment inline (same logic as store.getActiveSegment())
  const activeSegment = segments.find(s => s.status === 'active' || s.status === 'paused') ?? null;

  // Compute progress percentage for the active segment
  let progressPct = 0;
  if (activeSegment && activeSegment.status === 'active' && activeSegment.end_time) {
    const remainingMs = Math.max(0, new Date(activeSegment.end_time).getTime() - Date.now());
    const totalMs = activeSegment.allocated_seconds * 1000;
    progressPct = totalMs > 0 ? Math.max(0, Math.min(100, ((totalMs - remainingMs) / totalMs) * 100)) : 0;
  } else if (activeSegment && activeSegment.status === 'paused') {
    // Paused — show elapsed up to paused point (no animation)
    progressPct = 50; // static midpoint indicator; actual remaining is in paused_remaining_seconds
  }

  // Determine active speaker display name
  let activeSpeakerName = '';
  let activeSegmentDisplayName = '';
  if (activeSegment) {
    activeSegmentDisplayName = SEGMENT_DISPLAY_NAME[activeSegment.segment_type] ?? activeSegment.segment_type;
    if (activeSegment.speaker_id === null) {
      activeSpeakerName = 'Cross-Examination';
    } else {
      const speaker = speakers[activeSegment.speaker_id];
      activeSpeakerName = speaker?.display_name ?? '';
    }
  }

  // If the store is empty (loading or debate not started), use LD_SEGMENTS as placeholders
  const pillData = segments.length > 0
    ? segments
    : LD_SEGMENTS.map(ldSeg => ({
        id: ldSeg.segmentType,
        sequence_order: ldSeg.sequenceOrder,
        segment_type: ldSeg.segmentType,
        speaker_id: null as string | null,
        status: 'upcoming' as const,
        allocated_seconds: ldSeg.allocatedSeconds,
        end_time: null as string | null,
        paused_remaining_seconds: null as number | null,
        debate_id: '',
        bonus_seconds_used: 0,
        actual_start: null as string | null,
        actual_end: null as string | null,
        prep_time_end_time: null as string | null,
      }));

  // Variant-specific classes
  const containerClass = variant === 'mobile'
    ? `sticky top-0 z-10 bg-slate-950/95 backdrop-blur flex flex-col gap-1 p-2 ${className}`
    : `flex flex-col gap-2 p-3 ${className}`;

  const pillsRowClass = variant === 'mobile'
    ? 'flex flex-row gap-1 overflow-x-auto'
    : 'flex flex-row gap-2';

  const pillBaseClass = variant === 'mobile'
    ? 'relative shrink-0 px-2 py-1 rounded text-xs font-medium overflow-hidden transition-all'
    : 'relative px-3 py-2 rounded text-sm font-medium overflow-hidden transition-all';

  return (
    <div className={containerClass} role="region" aria-label="Debate segment timeline">
      {/* Segment pills row */}
      <div className={pillsRowClass}>
        {pillData.map(seg => {
          const isActive = seg.status === 'active';
          const isPaused = seg.status === 'paused';
          const isCompleted = seg.status === 'completed';
          const abbrev = SEGMENT_ABBREV[seg.segment_type] ?? '?';

          // Pill visual state classes
          let pillClass = '';
          if (isActive) {
            pillClass = 'bg-blue-600 text-white ring-2 ring-blue-400';
          } else if (isPaused) {
            pillClass = 'bg-amber-600 text-white ring-2 ring-amber-300';
          } else if (isCompleted) {
            pillClass = 'bg-slate-700 text-slate-300 opacity-70';
          } else {
            pillClass = 'bg-slate-800 text-slate-500';
          }

          // Progress fill for active segment
          const showProgress = (isActive || isPaused) && seg.id === activeSegment?.id;

          return (
            <div
              key={seg.id}
              className={`${pillBaseClass} ${pillClass}`}
              aria-current={isActive || isPaused ? 'step' : undefined}
              title={SEGMENT_DISPLAY_NAME[seg.segment_type] ?? seg.segment_type}
            >
              {/* Progress fill overlay (behind text, z-0) */}
              {showProgress && isActive && (
                <div
                  className="absolute inset-0 bg-blue-400/30 transition-none"
                  style={{ width: `${progressPct}%` }}
                  aria-hidden="true"
                />
              )}
              {showProgress && isPaused && (
                <div
                  className="absolute inset-0 bg-amber-400/30"
                  style={{ width: `${progressPct}%` }}
                  aria-hidden="true"
                />
              )}
              {/* Pill label (above progress fill) */}
              <span className="relative z-10">{abbrev}</span>
            </div>
          );
        })}
      </div>

      {/* Status row — current phase name and active speaker */}
      <div
        className="text-xs text-slate-400 px-1 min-h-[1.25rem]"
        aria-live="polite"
        aria-atomic="true"
      >
        {activeSegment ? (
          <span>
            <span className="font-medium text-slate-200">{activeSegmentDisplayName}</span>
            {activeSpeakerName && (
              <>
                <span className="mx-1 text-slate-600">·</span>
                <span>{activeSpeakerName}</span>
              </>
            )}
            {activeSegment.status === 'paused' && (
              <span className="ml-1 text-amber-400">(Prep Time)</span>
            )}
          </span>
        ) : segments.length === 0 ? (
          <span>Waiting for debate to begin...</span>
        ) : (
          <span>Debate complete</span>
        )}
      </div>
    </div>
  );
}
