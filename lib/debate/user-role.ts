/**
 * Which role a viewer holds in one debate.
 *
 * `anonymous` is decided by the session, not by this file — see
 * `hooks/useUserRole.ts`.  Everything here answers one question: given the
 * debate's seats, what is this user?
 */
export type UserRole = 'observer' | 'speaker' | 'moderator' | 'anonymous';

/** The seat roles `listening.debate_speakers.role` can hold. */
export type SeatRole = 'affirmative' | 'negative' | 'moderator' | 'panelist';

/** The part of a `debate_speakers` row this resolution needs. */
export interface SpeakerSeat {
  user_id: string | null;
  role: SeatRole;
}

/**
 * The role a user holds, when they hold more than one seat.
 *
 * One person with two rows is a normal shape, not only a test artifact: a
 * moderator who also speaks later, a seat reassigned mid-setup leaving a
 * stale row, or the same account seeded into several seats.
 *
 * This used to be `seats.find(s => s.user_id === userId)` — the first row
 * that matched, whatever its role.  Neither snapshot query sorted, so "first"
 * meant Postgres heap order: physical, not logical.  An `UPDATE` rewrites a
 * tuple and moves it to the end of the heap, so an unrelated edit to one
 * speaker row silently changed which role a dual-seated user resolved to, and
 * a panelist row ahead of a speaking row made a real speaker an observer.
 * Nothing errored; the person just quietly lost their rebuttal checklist.
 *
 * Precedence is explicit here so the answer does not depend on row order at
 * all.  The snapshot queries sort as well (defence in depth), but ordering a
 * query cannot be the fix on its own: `upsertSpeaker` writes into a keyed
 * object at runtime, so a Realtime update re-orders `Object.values` after the
 * query's order is long gone.
 */
export function resolveParticipantRole(
  seats: readonly SpeakerSeat[],
  userId: string | null,
): Exclude<UserRole, 'anonymous'> {
  // An unclaimed seat carries user_id = null.  Without this guard a viewer
  // with no id would match one and inherit its role.
  if (!userId) return 'observer';

  const mine = seats.filter((s) => s.user_id === userId);
  if (mine.some((s) => s.role === 'moderator')) return 'moderator';
  if (mine.some((s) => s.role === 'affirmative' || s.role === 'negative')) return 'speaker';

  // Seated as a panelist only, or not seated at all.  Panelists have no
  // speaker surface in v1, so they see what an observer sees.
  return 'observer';
}
