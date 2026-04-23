export function computeDebateTimeMmss(actualStart: Date, spokenAt: Date): string {
  const elapsedMs = spokenAt.getTime() - actualStart.getTime();
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
