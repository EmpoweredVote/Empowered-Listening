'use client';

import { useEffect, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';

type TimerState = 'normal' | 'warning' | 'red_mode' | 'expired';

function computeState(remainingMs: number, totalMs: number): TimerState {
  if (remainingMs <= 0) return 'expired';
  const pct = remainingMs / totalMs;
  if (pct <= 0.10) return 'red_mode';
  if (pct <= 0.25) return 'warning';
  return 'normal';
}

function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Claude's-discretion colors (CONTEXT.md locked progression: neutral → amber → red → flash)
const STATE_CLASSES: Record<TimerState, string> = {
  normal:   'text-slate-200 bg-slate-800',
  warning:  'text-slate-900 bg-amber-400',
  red_mode: 'text-white bg-red-600',
  expired:  'text-white bg-red-600 lk-timer-blink',
};

interface SegmentTimerProps {
  className?: string;
}

export function SegmentTimer({ className = '' }: SegmentTimerProps) {
  // Subscribe to the active segment — re-renders when status / end_time changes
  const segmentId = useDebateStore(s => s.getActiveSegment()?.id ?? null);
  const totalMs = useDebateStore(s => (s.getActiveSegment()?.allocated_seconds ?? 0) * 1000);
  const [, forceTick] = useState(0);

  // Local tick — drives the countdown display without storing ticks in Zustand
  useEffect(() => {
    const iv = setInterval(() => forceTick(n => n + 1), 100);
    return () => clearInterval(iv);
  }, []);

  if (!segmentId) return null;

  const remainingMs = useDebateStore.getState().computeRemainingMs();
  const state = computeState(remainingMs, totalMs);

  return (
    <div
      className={`rounded-lg px-6 py-4 font-mono text-5xl tabular-nums ${STATE_CLASSES[state]} ${className}`}
      data-timer-state={state}
      aria-live="polite"
    >
      {formatMMSS(remainingMs)}
    </div>
  );
}
