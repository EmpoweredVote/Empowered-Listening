'use client';

import { useEffect, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';

export function PrepTimeDisplay({ className = '' }: { className?: string }) {
  const isPaused = useDebateStore(s => s.getActiveSegment()?.status === 'paused');
  const [, force] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => force(n => n + 1), 200);
    return () => clearInterval(iv);
  }, []);

  if (!isPaused) return null;
  const remainingMs = useDebateStore.getState().computePrepRemainingMs();
  const mm = Math.floor(remainingMs / 1000 / 60);
  const ss = Math.floor(remainingMs / 1000) % 60;

  return (
    <div className={`rounded bg-blue-900 px-3 py-2 text-white ${className}`}>
      <span className="text-xs uppercase tracking-wide">Prep</span>
      <span className="ml-2 font-mono tabular-nums">{mm}:{ss.toString().padStart(2, '0')}</span>
    </div>
  );
}
