/**
 * Pure rules for deciding when a debate has been abandoned.
 *
 * Kept free of `pg`, the LiveKit SDK and `server-only` so it can be unit-tested
 * — the same split as `lib/debate/teardown-rules.ts` and `lib/debate/joinable.ts`.
 *
 * A debate stays `live` until something ends it. The moderator pressing **End
 * debate** ends it; so does driving it to the end of segment 7, which flips the
 * row to `completed` and tears down there. Every other ending — a closed
 * laptop, a crashed tab, a walkthrough abandoned two minutes in — left the row
 * reading `live` forever. On 2026-11-20 one sat that way for six and a half
 * hours with its segment 1 timer six hours past expiry.
 *
 * Only speakers and the moderator keep a debate alive. All three hold LiveKit
 * seats, so "is anyone running this debate" is answerable from the room's
 * participant count. Observers watch Mux HLS anonymously and hold no seat, so
 * they cannot hold a dead debate open — which is the behaviour we want.
 */

import type { DebateLifecycle } from './teardown-rules';

/**
 * How long a debate's room must be continuously empty before the debate is
 * ended.
 *
 * Two minutes, to outlast a page refresh, a laptop lid, and a stretch of bad
 * conference wifi. Cancelling a debate that was merely reconnecting would be
 * worse than the bug this fixes: it destroys something real rather than
 * leaving something dead.
 *
 * Deliberately a separate constant from `SWEEP_GRACE_MS`, despite holding the
 * same value today. That one covers the window between egress bootstrap and
 * the `status = 'live'` write; this one covers a reconnect. They answer
 * different questions and will drift apart.
 */
export const ABANDON_GRACE_MS = 2 * 60_000;

/**
 * The "empty since" timestamp for a debate, given the previous one and this
 * tick's participant count.
 *
 * `participants` is `null` when LiveKit could not be asked at all. That is not
 * evidence of an empty room, and it must never be treated as one: if a failed
 * lookup started the clock, a LiveKit outage lasting longer than the grace
 * window would cancel every live debate at once — the exact opposite of what
 * this is for. So an unknown count holds whatever the clock already said,
 * neither starting nor clearing it.
 *
 * Returns the timestamp the room has been empty since, or `null` when it is
 * occupied or has never been observed empty.
 */
export function nextEmptySince(
  previous: number | null,
  participants: number | null,
  nowMs: number,
): number | null {
  if (participants === null) return previous;
  if (participants > 0) return null;
  return previous ?? nowMs;
}

export interface AbandonCandidate {
  /** The debate's status, or `null` if the row has gone. */
  status: DebateLifecycle | null;
  /** When the room was first seen empty, or `null` if it is not empty. */
  emptySinceMs: number | null;
  nowMs: number;
}

/**
 * Should this debate be ended for having nobody in it?
 *
 * Only a `live` debate can be abandoned. A `scheduled` one has an empty room
 * by definition — nobody has arrived yet — and ending it would cancel debates
 * before they start. `completed` and `cancelled` are already over, and a
 * missing row has nothing left to end.
 */
export function shouldEndAbandoned({ status, emptySinceMs, nowMs }: AbandonCandidate): boolean {
  if (status !== 'live') return false;
  if (emptySinceMs === null) return false;
  return nowMs - emptySinceMs >= ABANDON_GRACE_MS;
}
