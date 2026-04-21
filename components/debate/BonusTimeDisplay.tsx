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
  const [, force] = useState(0);

  // Track which (debateId, segmentId) pair we've already fired end-segment for
  // so we don't fire twice (React StrictMode or re-render bursts).
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    const iv = setInterval(() => force(n => n + 1), 200);
    return () => clearInterval(iv);
  }, []);

  if (!active || active.status !== 'active' || !active.speaker_id || !active.end_time) return null;

  const endTimeMs = new Date(active.end_time).getTime();
  const now = Date.now();

  // Only render after the MAIN segment's end_time has passed (main timer expired).
  if (now < endTimeMs) return null;

  const speaker = speakers[active.speaker_id];
  if (!speaker) return null;

  // Client-computed bonus remaining.  The DB row's bonus_time_seconds
  // is a STATIC pool at the start of the segment — the server does not tick it.  We
  // compute live remaining as (pool_ms) - (ms since main expired).  This is both the
  // display value AND the zero-detection source.
  const msSinceExpired = now - endTimeMs;
  const bonusPoolMs = speaker.bonus_time_seconds * 1000;
  const bonusRemainingMs = Math.max(0, bonusPoolMs - msSinceExpired);

  // Exhaustion — fire end-segment once per (debateId, segmentId).
  if (bonusRemainingMs <= 0) {
    const key = `${debateId}:${active.id}`;
    if (firedRef.current !== key) {
      firedRef.current = key;
      const token = typeof window !== 'undefined' ? localStorage.getItem('ev_token') : null;
      void fetch(`/api/debates/${debateId}/segments/${active.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'end' }),
      });
    }
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
