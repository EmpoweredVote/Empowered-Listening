/**
 * When a segment actually runs out: `end_time` plus whatever is left of the
 * speaker's bonus pool.
 *
 * Its own module, with no `server-only` import and no database, so it can be
 * tested directly — the same reason `lib/auth/user-id.ts` is split out. This is
 * the part of expiry most worth getting right: an error here either cuts a
 * speaker off early or lets the debate run past its clock.
 */
export function expiryTimestamp(
  endTimeIso: string,
  bonusSeconds: number,
  hasSpeaker: boolean,
): number {
  const base = new Date(endTimeIso).getTime();
  if (Number.isNaN(base)) return NaN;
  // A segment with no speaker (CX, moderator-run) gets no bonus: there is
  // nobody whose pool it would come out of.
  const bonusMs = hasSpeaker ? Math.max(0, bonusSeconds) * 1000 : 0;
  return base + bonusMs;
}
