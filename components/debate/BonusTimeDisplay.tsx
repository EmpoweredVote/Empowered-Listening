'use client';

import { useEffect, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';
import { serverNow } from '@/lib/debate/clock';

interface BonusTimeDisplayProps {
  className?: string;
}

/**
 * Renders the speaker's remaining bonus time. Display only.
 *
 * This used to POST `action: 'end'` when the pool hit zero, which made the
 * moderator's open tab the thing that actually enforced the clock. Expiry is
 * now scheduled server-side (lib/debate/expiry-registry.ts), so this component
 * counts down and nothing more — "clients render, they never enforce".
 */
export function BonusTimeDisplay({ className = '' }: BonusTimeDisplayProps) {
  const active = useDebateStore(s => s.getActiveSegment());
  const speakers = useDebateStore(s => s.speakers);
  // 200ms tick. "now" lives in state so render stays pure (no clock read in
  // render). serverNow() rather than Date.now(): this value is compared with
  // end_time from the server, and it decides when bonus time is exhausted and
  // the segment ends — a skewed browser clock would end a speaker early.
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const iv = setInterval(() => setNow(serverNow()), 200);
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

  // True once the pool is spent. The server ends the segment; this is just the
  // zeroed readout shown until that lands and the store updates.
  const exhausted = visible && now >= endTimeMs && bonusRemainingMs <= 0;

  if (!visible || now < endTimeMs) return null;

  if (exhausted) {
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
