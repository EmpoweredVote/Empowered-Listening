# Ending a debate nobody is in

**Date:** 2026-11-20
**Size:** small change
**Status:** approved 2026-11-20
**Plan:** `docs/superpowers/plans/2026-11-20-debate-abandon-watch.md`

## Intent

A debate stays `live` until something explicitly ends it. Today the only things
that do are the moderator pressing **End debate**, or the moderator driving the
debate all the way to the end of segment 7. Every other ending — a closed
laptop, a crashed tab, a walkthrough abandoned two minutes in — leaves the row
reading `live` forever.

That happened on 2026-11-20: debate `d008dcf0-4430-4537-a901-94d8719c0673`,
started 20:33 UTC, segment 1 expired at 20:39 UTC, still `active` and still
`live` six and a half hours later. No egress had been started, so nothing
billed — but the same abandonment after a segment start, when an egress *is*
attached, is the 6h18m incident the teardown work exists to prevent.

This adds the missing ending: when the people running a debate are all gone,
the server ends it.

## Why this and not the existing guards

- `sweepOrphanedEgress` protects the bill, not the row. It works from
  LiveKit's active-egress list, so a debate with no egress — exactly the one
  above — is invisible to it.
- PR #76 (`feat/server-side-segment-expiry`) makes *segments* advance without a
  moderator tab. A debate whose last segment expires server-side still needs
  someone to end the debate. #76 does not close this.

## Goals

- A `live` debate whose LiveKit room has been empty past a grace window is
  ended, with media released through the one sanctioned path.
- The decision is made server-side, from state the server can see without
  trusting a client.
- Nothing new is required outside this repo to make it work.

## Non-goals

- **Observer presence.** Decided: observers do not keep a debate alive. They
  watch Mux HLS anonymously and hold no LiveKit seat, so they are invisible
  here by construction, which is the behaviour we want.
- Segment auto-expire — that is #76.
- Ending `scheduled` debates. Nobody has arrived yet; there is nothing to end.
- Render cron or any ev-infra change.
- Correctness across more than one web instance (see Constraints).

## Anti-goals

Things that would make this a failure even if it technically works:

- **Cancelling a debate that is merely reloading.** A moderator refreshing the
  page, or thirty seconds of bad hotel wifi, must not end a live debate. That
  would be worse than the bug being fixed, because it destroys something real
  rather than leaving something dead.
- **A second teardown path.** If this ends a debate any way other than the
  shared one, it reintroduces precisely the leak CLAUDE.md warns about.

## Constraints

- `teardownDebateMedia` is the only sanctioned way to release egress, Mux and
  the transcription worker (CLAUDE.md).
- Timers are server-authoritative; clients render, they never enforce.
- Never run an unfiltered aggregate on this instance's big tables. The watcher
  reads `listening.debates` filtered to `status = 'live'`, which is bounded by
  the number of debates running at once.
- The service runs a single Render instance. Module-scope state is viable and
  is already the pattern (`lib/transcription/registry.ts`). If it is ever
  scaled past one instance, every instance runs its own watcher — see
  "Known limits".

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **LiveKit webhooks** — handle `room_finished` / `participant_left` | Event-driven and uses LiveKit's own empty-room timer. But it needs a new public endpoint with signature verification, and a webhook URL configured in the LiveKit project, which this repo does not own. Delivery is not guaranteed, so it still needs a sweeper underneath — and that sweeper is B. |
| B | **Poll LiveKit presence server-side** ✅ | No new public surface, no configuration outside the repo. Presence lives in LiveKit rather than in our memory, so a redeploy loses no ground truth. Costs a few seconds of latency and a second module-scope timer. |
| C | **Generalize `sweepOrphanedEgress` into a debate sweep, driven by a Render cron** | Reuses real machinery, but the schedule is declared in ev-infra's `render.yaml`. The fix would not be complete when this repo says it is. |

**Chosen: B.** A is better in the abstract and worse here — it depends on
configuration we do not control and needs B as a backstop regardless. C's logic
is right, but putting the trigger in another repo means merging here does not
make it work.

## Design

### Shape

Four pieces, mirroring splits the repo already uses:

1. **`lib/debate/abandon-rules.ts`** — pure, no `pg`, no SDK, no `server-only`.
   Decides whether a debate should be ended given its status, whether its room
   is empty, and how long it has been empty. Unit-tested. Same split as
   `teardown-rules.ts` and `joinable.ts`.

2. **`lib/livekit/room-service.ts`** — add `countParticipants(roomName)`.
   The `RoomServiceClient` is already constructed here; only the call is new.

3. **`lib/debate/abandon-watch.ts`** — `server-only`. Holds the interval and
   the per-debate "empty since" clock in module scope, the same shape as
   `lib/transcription/registry.ts`. Each tick reads the `live` debates, asks
   LiveKit how many participants each room holds, and ends the ones past grace.

4. **`lib/debate/end-debate.ts`** — the end sequence extracted out of
   `app/api/debates/[debateId]/end/route.ts`, so the route and the watcher
   share one path. The route keeps the auth and the HTTP shape and calls this;
   the watcher calls it directly.

Boot from `instrumentation.ts`, under the existing `NEXT_RUNTIME === 'nodejs'`
guard.

### The rules

- Only `status = 'live'` is considered. `scheduled` is never touched.
- **Empty** means zero participants in `ld-<debateId>`. A room LiveKit does not
  know about counts as empty — a room is created on first join, so "no such
  room" and "nobody in the room" mean the same thing here.
- A debate must be continuously empty for **`ABANDON_GRACE_MS = 2 * 60_000`**
  before it is ended. Any tick that sees a participant clears the clock. Named
  separately from `SWEEP_GRACE_MS` despite having the same value: that one
  covers the window between egress bootstrap and the `live` write, this one
  covers a page refresh. They will drift apart.
- **Poll every 30s.** Worst case a debate ends ~2.5 minutes after the last
  person leaves.
- Outcome is **`cancelled`**, not `completed`. `endSegment` already flips a
  debate to `completed` when segment 7 ends and tears down there, so a debate
  still reading `live` did not finish. `cancelled` is what the route's own
  comment calls "one abandoned" — and the record should say what happened.
- Ending runs `notifyDebateChanged(debateId, 'debate-end')`, so any surviving
  observer tab learns it is over instead of waiting on a debate that will
  never move.

### Calls I made, and why

- **The empty-since clock is in memory, not a column.** It avoids a migration
  for state that is worthless after a restart anyway. The cost: a redeploy
  resets the clock, so an abandoned debate survives up to one extra grace
  window. That is acceptable for a backstop measured in minutes.
- **Extracting `end-debate.ts` is in scope.** It is the difference between one
  ending and two. PR #76 re-implements the three-way release inline in
  `end-segment-flow.ts`, which is the mistake CLAUDE.md now names; this should
  not repeat it one module over.
- **Built on current `master`, independent of #76.** #76 is deliberately held
  until after the Phase 5 sitting, and this should not be held with it. Both
  touch `instrumentation.ts`, so expect a small textual conflict when #76
  rebases — and whoever does that rebase should consider folding the two
  module-scope registries into one.

## Known limits

Documented in the module, matching how `expiry-registry.ts` documents the same
constraint: this holds state in module scope and assumes a single instance
(`numInstances: 1`). Scaled past one, every instance runs its own watcher and
races to end the same debate. The end path is idempotent — `teardownDebateMedia`
is safe to call more than once, and the status UPDATE is guarded on
`status IN ('scheduled','live')` — so the outcome stays correct, but at that
point the watcher belongs in a single worker or behind an advisory lock.

## Left to the builder

- The exact failure shape `RoomServiceClient.listParticipants` returns for a
  room that does not exist, and mapping it to "empty" rather than to an error.
- Test doubles for the room service; follow the mocking already used in
  `app/api/debates/[debateId]/segments/[segmentId]/route.test.ts`.
- Whether each tick logs, or only the ticks that end something. Prefer the
  latter plus a one-line startup log, so a quiet service stays quiet.

## Verification

- Unit tests on `abandon-rules.ts`: live + empty + past grace ends; live +
  empty + inside grace does not; live + occupied never does; `scheduled`,
  `completed` and `cancelled` never do; a participant appearing resets the
  clock.
- A revert check on the rules: break the grace comparison and confirm tests
  fail.
- Manually, against the stale debate if one is available: watch it move to
  `cancelled` without touching a browser.
