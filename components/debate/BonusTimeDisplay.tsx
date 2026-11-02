'use client';

import { useEffect, useRef, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';

interface BonusTimeDisplayProps {
  debateId: string;
  className?: string;
}

export function BonusTimeDisplay({ debateId, className = '' }: BonusTimeDisplayProps) {
  const active = useDebateStore(s => s.getActiveSegment());
  const speakers = useDebateStore(s => s.speakers);
  // 200ms tick. "now" lives in state so render stays pure (no Date.now() in render).
  const [now, setNow] = useState(() => Date.now());

  // Track which (debateId, segmentId) pair we've already fired end-segment for
  // so we don't fire twice (React StrictMode or re-render bursts).
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(iv);
  }, []);

  const speaker = active?.speaker_id ? speakers[active.speaker_id] : undefined;
  const visible = !!active && active.status === 'active' && !!active.end_time && !!speaker;
  const endTimeMs = visible ? new Date(active.end_time!).getTime() : 0;

  // Client-computed bonus remaining.  The DB row's bonus_time_seconds
  // is a STATIC pool at the start of the segment — the server does not tick it.  We
  // compute live remaining as (pool_ms) - (ms since main expired).  This is both the
  // display value AND the zero-detection source.
  const msSinceExpired = now - endTimeMs;
  const bonusPoolMs = (speaker?.bonus_time_seconds ?? 0) * 1000;
  const bonusRemainingMs = Math.max(0, bonusPoolMs - msSinceExpired);

  // Segment whose bonus is exhausted, or null.  Only shown (and only exhausted)
  // after the MAIN segment's end_time has passed.
  const exhaustedSegmentId =
    visible && now >= endTimeMs && bonusRemainingMs <= 0 ? active!.id : null;

  // Exhaustion — fire end-segment once per (debateId, segmentId).  Runs in an
  // effect, never during render, so a double render cannot send it twice.
  useEffect(() => {
    if (!exhaustedSegmentId) return;
    const key = `${debateId}:${exhaustedSegmentId}`;
    if (firedRef.current === key) return;
    firedRef.current = key;
    const token = localStorage.getItem('ev_token');
    void fetch(`/api/debates/${debateId}/segments/${exhaustedSegmentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'end' }),
    });
  }, [exhaustedSegmentId, debateId]);

  if (!visible || now < endTimeMs) return null;

  if (exhaustedSegmentId) {
    // Render zeroed state briefly until the server flips the segment to completed.
    return (
      <div className={`rounded bg-red-800 px-3 py-2 text-white ${className}`}>
        <span className="text-xs uppercase tracking-wide">Bonus</span>
        <span className="ml-2 font-mono tabular-nums">0:00</span>
      </div>
    );
  }

  const bonusSecondsRemaining = Math.ceil(bonusRemainingMs / 1000);
  const mm = Math.floor(bonusSecondsRemaining / 60);
  const ss = bonusSecondsRemaining % 60;

  return (
    <div className={`rounded bg-red-800 px-3 py-2 text-white ${className}`}>
      <span className="text-xs uppercase tracking-wide">Bonus</span>
      <span className="ml-2 font-mono tabular-nums">{mm}:{ss.toString().padStart(2, '0')}</span>
    </div>
  );
}
