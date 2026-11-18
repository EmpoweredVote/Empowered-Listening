/**
 * Pure rules for deciding what to tear down. Kept free of `pg`, the LiveKit
 * SDK and `server-only` so it can be unit-tested — the same split as
 * `lib/debate/joinable.ts`.
 */

/** Statuses a debate row can hold. `null` means the row is gone entirely. */
export type DebateLifecycle = 'scheduled' | 'live' | 'completed' | 'cancelled';

/** Rooms are minted as `ld-<debateId>` (see the debates POST route). */
const ROOM_NAME_PREFIX = 'ld-';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recover the debate id from a LiveKit room name.
 *
 * The sweep works from LiveKit's own list of active egresses rather than from
 * our `livekit_egress_id` column, because the failure we are guarding against
 * is precisely that the column and reality disagree. The room name is the only
 * link back to a debate, so it has to be parsed rather than looked up.
 *
 * Returns null for any room this app did not mint, so a sweep can never stop
 * an egress belonging to something else sharing the LiveKit project.
 */
export function debateIdFromRoomName(roomName: string): string | null {
  if (!roomName.startsWith(ROOM_NAME_PREFIX)) return null;
  const candidate = roomName.slice(ROOM_NAME_PREFIX.length);
  return UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * How long an egress must have been running before the sweep will stop it for
 * belonging to a non-live debate.
 *
 * Egress bootstrap and the `status = 'live'` write are separate transactions,
 * so there is a window where an egress is legitimately active while the debate
 * still reads `scheduled`. Without this grace the sweep could kill a debate
 * that was in the middle of starting.
 */
export const SWEEP_GRACE_MS = 2 * 60_000;

export interface SweepCandidate {
  /** Status of the debate the room maps to, or null if no such debate exists. */
  status: DebateLifecycle | null;
  /** How long this egress has been running. */
  ageMs: number;
}

/**
 * Should the sweep stop this egress?
 *
 * Only a `live` debate justifies a running egress. Anything else — completed,
 * cancelled, never started, or a debate row that has been deleted out from
 * under it — is an orphan, and an orphan bills by the minute until someone
 * notices. One ran for 6h18m before we found it by hand.
 */
export function shouldStopEgress({ status, ageMs }: SweepCandidate): boolean {
  if (status === 'live') return false;
  return ageMs >= SWEEP_GRACE_MS;
}
