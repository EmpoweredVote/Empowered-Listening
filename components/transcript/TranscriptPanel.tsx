'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranscriptSync, type FinalEntry, type InterimEntry } from '@/hooks/useTranscriptSync';
import { TranscriptEntry } from './TranscriptEntry';
import type { TranscriptEntryRow } from '@/app/api/debates/[debateId]/transcript/route';

interface Speaker {
  displayName: string;
  role: 'affirmative' | 'negative' | 'moderator';
}

interface DebateSegment {
  id: string;
  name: string;
  actual_start: string | null;  // ISO timestamp or null if not yet started
  allocated_seconds: number;
}

interface TranscriptPanelProps {
  debateId: string;
  speakers: Record<string, Speaker>;  // speakerId (UUID) → speaker info
  segments: DebateSegment[];          // ordered array from debate store
}

/** Format seconds as "m:ss" — e.g., 480 → "8:00", 65 → "1:05" */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Find which segment an entry belongs to (latest segment whose actual_start <= spoken_at) */
function findSegmentForEntry(
  spokenAt: string,
  sortedSegments: DebateSegment[],
): DebateSegment | null {
  const spokenMs = new Date(spokenAt).getTime();
  let best: DebateSegment | null = null;
  for (const seg of sortedSegments) {
    if (!seg.actual_start) continue;
    if (new Date(seg.actual_start).getTime() <= spokenMs) {
      best = seg;
    }
  }
  return best;
}

/**
 * TranscriptPanel — live-updating transcript panel.
 *
 * 1. On mount: loads DB snapshot via GET /api/debates/[debateId]/transcript
 * 2. Subscribes to Supabase broadcast channel for live updates
 * 3. Renders segment header dividers between LD segments
 * 4. Auto-scrolls to bottom; shows "Back to live" button when scrolled up
 */
export function TranscriptPanel({ debateId, speakers, segments }: TranscriptPanelProps) {
  const [entries, setEntries] = useState<TranscriptEntryRow[]>([]);
  const [interims, setInterims] = useState<Record<string, string>>({}); // speakerId → text
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isFollowingLiveRef = useRef(true);

  // Keep ref in sync with state (to avoid stale closure in callbacks)
  useEffect(() => {
    isFollowingLiveRef.current = isFollowingLive;
  }, [isFollowingLive]);

  // Load initial snapshot from DB
  useEffect(() => {
    fetch(`/api/debates/${debateId}/transcript`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          throw new Error(`Transcript fetch failed (${r.status}): ${body || r.statusText}`);
        }
        return r.json() as Promise<{ entries: TranscriptEntryRow[] }>;
      })
      .then(data => {
        setEntries(data.entries);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load transcript';
        setLoadError(msg);
        console.error('[TranscriptPanel] snapshot error:', err);
      });
  }, [debateId]);

  // Scroll to bottom when entries or interims change while following live
  useEffect(() => {
    if (isFollowingLiveRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, interims]);

  // Handle scroll: pause auto-scroll when user scrolls up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (atBottom !== isFollowingLiveRef.current) {
      isFollowingLiveRef.current = atBottom;
      setIsFollowingLive(atBottom);
    }
  }, []);

  // Broadcast callbacks
  const onFinal = useCallback((entry: FinalEntry) => {
    const newEntry: TranscriptEntryRow = {
      id: `${entry.speakerId}-${entry.spokenAt}`,
      speaker_id: entry.speakerId,
      spoken_at: entry.spokenAt,
      debate_time_mmss: entry.debateTimeMmss,
      text: entry.text,
      confidence_score: null,
    };
    setEntries(prev => [...prev, newEntry]);
    // Remove interim for this speaker
    setInterims(prev => {
      if (!prev[entry.speakerId]) return prev;
      const next = { ...prev };
      delete next[entry.speakerId];
      return next;
    });
  }, []);

  const onInterim = useCallback((entry: InterimEntry) => {
    setInterims(prev => ({ ...prev, [entry.speakerId]: entry.text }));
  }, []);

  useTranscriptSync(debateId, onFinal, onInterim);

  // Sort segments by actual_start for grouping logic
  const sortedSegments = [...segments]
    .filter(s => s.actual_start !== null)
    .sort((a, b) => new Date(a.actual_start!).getTime() - new Date(b.actual_start!).getTime());

  // Build ordered list of (segmentId | null, entry) pairs with segment headers
  type RenderItem =
    | { type: 'header'; segment: DebateSegment }
    | { type: 'entry'; entry: TranscriptEntryRow };

  const renderItems: RenderItem[] = [];
  let lastSegmentId: string | null = null;

  for (const entry of entries) {
    const seg = findSegmentForEntry(entry.spoken_at, sortedSegments);
    if (seg && seg.id !== lastSegmentId) {
      renderItems.push({ type: 'header', segment: seg });
      lastSegmentId = seg.id;
    }
    renderItems.push({ type: 'entry', entry });
  }

  const hasInterims = Object.keys(interims).length > 0;
  const isEmpty = entries.length === 0 && !hasInterims;

  const scrollToBottom = useCallback(() => {
    isFollowingLiveRef.current = true;
    setIsFollowingLive(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="relative h-full flex flex-col">
      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {loadError && (
          <div className="px-3 py-2 text-xs text-red-400">
            {loadError}
          </div>
        )}

        {isEmpty && !loadError && (
          <p className="px-3 py-4 text-slate-500 text-sm">
            Transcript will appear here when speakers begin.
          </p>
        )}

        {renderItems.map((item, idx) => {
          if (item.type === 'header') {
            return (
              <div
                key={`header-${item.segment.id}`}
                className="py-2 px-2 mt-3 mb-1 border-b border-slate-700"
              >
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
                  {item.segment.name} — {formatDuration(item.segment.allocated_seconds)}
                </span>
              </div>
            );
          }
          const entry = item.entry;
          const speaker = speakers[entry.speaker_id];
          return (
            <TranscriptEntry
              key={entry.id ?? idx}
              entry={{
                speakerId: entry.speaker_id,
                text: entry.text,
                spokenAt: entry.spoken_at,
                debateTimeMmss: entry.debate_time_mmss,
              }}
              speaker={speaker}
            />
          );
        })}

        {/* Interim (partial) results — rendered at bottom, ephemeral */}
        {hasInterims && (
          <div className="px-3 py-2 space-y-1">
            {Object.entries(interims).map(([speakerId, text]) => {
              const speaker = speakers[speakerId];
              return (
                <p key={speakerId} className="text-slate-400 italic text-sm leading-snug">
                  {speaker?.displayName ?? 'Unknown'}: {text}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* Back to live button — shown when user has scrolled up */}
      {!isFollowingLive && (
        <div className="absolute bottom-2 right-2">
          <button
            onClick={scrollToBottom}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg transition-colors"
          >
            Back to live ↓
          </button>
        </div>
      )}
    </div>
  );
}
