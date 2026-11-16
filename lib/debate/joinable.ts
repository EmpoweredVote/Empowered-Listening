/**
 * Which debate statuses a speaker seat can still be joined on.
 *
 * A debate id is public by design — `/debates/[debateId]` is fully anonymous —
 * so a share link that reaches the wrong person must stop working once the
 * debate it belongs to is over or called off.  Before this, the token route
 * looked up a seat without ever consulting `debates.status`, which meant a
 * leaked join link stayed valid forever.
 *
 * Kept as a plain predicate (no `server-only` import) so it can be unit tested:
 * the route itself pulls in `pg`, `@livekit/rtc-node` and the fail-fast env
 * schema, none of which load under vitest.  The same status list is repeated as
 * SQL literals in the claiming UPDATE, deliberately — that statement has to
 * re-check the condition in the database, where it cannot call this.
 */
export const DEBATE_JOINABLE_STATUSES = ['scheduled', 'live'] as const;

export type DebateJoinableStatus = (typeof DEBATE_JOINABLE_STATUSES)[number];

export function isDebateJoinable(status: string): status is DebateJoinableStatus {
  return (DEBATE_JOINABLE_STATUSES as readonly string[]).includes(status);
}
