# Debate Abandon-Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End a `live` debate automatically once its LiveKit room has been empty of speakers and moderator for two continuous minutes, releasing media through the one sanctioned teardown path.

**Architecture:** A pure rules module decides; a `server-only` watcher polls LiveKit every 30s and holds the per-debate "empty since" clock in module scope; both the watcher and `POST /end` end a debate through one extracted function, so there is exactly one ending. Booted from `instrumentation.ts`.

**Tech Stack:** TypeScript, Next.js 16 route handlers, `livekit-server-sdk` `RoomServiceClient`, `pg` via `getPool()`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-debate-abandon-watch-design.md`

## Global Constraints

- `teardownDebateMedia` (`lib/debate/teardown.ts`) is the only way to release egress, Mux and the transcription worker. Never stop one of the three inline.
- `ABANDON_GRACE_MS = 2 * 60_000`. `ABANDON_POLL_MS = 30_000`.
- Outcome written is `'cancelled'`, never `'completed'`.
- Only `status = 'live'` debates are candidates. `scheduled`, `completed` and `cancelled` are never touched.
- Observers hold no LiveKit seat and must never keep a debate alive.
- Every `listening.debates` read is filtered — never an unfiltered scan (shared Supabase instance).
- Pure rule modules import neither `pg`, nor the LiveKit SDK, nor `server-only`.
- Branch from `origin/master`; land by PR. Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

Behaviours the spec implies that no task's happy path exercises. Each has a test in the task that owns the code.

1. **LiveKit unreachable is not "empty".** A failed `listParticipants` must preserve the existing clock, never start one — otherwise an API outage cancels every live debate at once. (Task 1, `nextEmptySince`)
2. **Overlapping ticks.** A slow LiveKit call means the next interval fires before the previous finished; the watcher must not run two passes concurrently and end the same debate twice. (Task 4)
3. **Missing LiveKit credentials must not break boot.** `getRoomService()` throws when they are unset, which is the normal state in a local checkout. (Task 4)
4. **The clock map must not leak.** A long-running process that keeps an entry per debate ever seen grows without bound. (Task 4)
5. **A room LiveKit has never heard of is empty, not an error.** Rooms are created on first join, so "no such room" and "nobody there" mean the same thing. (Task 2)

---

### Task 1: Abandon rules

Pure decision layer. No mocks needed anywhere in this task.

**Files:**
- Create: `lib/debate/abandon-rules.ts`
- Test: `lib/debate/abandon-rules.test.ts`

**Interfaces:**
- Consumes: `DebateLifecycle` from `lib/debate/teardown-rules.ts`.
- Produces:
  - `ABANDON_GRACE_MS: number`
  - `nextEmptySince(previous: number | null, participants: number | null, nowMs: number): number | null`
  - `shouldEndAbandoned(input: { status: DebateLifecycle | null; emptySinceMs: number | null; nowMs: number }): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { ABANDON_GRACE_MS, nextEmptySince, shouldEndAbandoned } from './abandon-rules';

const T0 = 1_700_000_000_000;

describe('ABANDON_GRACE_MS', () => {
  it('is two minutes — long enough to outlast a page refresh', () => {
    expect(ABANDON_GRACE_MS).toBe(2 * 60_000);
  });
});

describe('nextEmptySince', () => {
  it('starts the clock when an occupied room first reads empty', () => {
    expect(nextEmptySince(null, 0, T0)).toBe(T0);
  });

  it('keeps the original timestamp while the room stays empty', () => {
    expect(nextEmptySince(T0, 0, T0 + 30_000)).toBe(T0);
  });

  it('clears the clock as soon as anyone is in the room', () => {
    expect(nextEmptySince(T0, 1, T0 + 30_000)).toBeNull();
  });

  it('preserves a running clock when LiveKit could not be asked', () => {
    // An API failure is not evidence of an empty room. Treating it as one
    // would cancel every live debate during a LiveKit outage.
    expect(nextEmptySince(T0, null, T0 + 30_000)).toBe(T0);
  });

  it('does not start a clock from a failed lookup', () => {
    expect(nextEmptySince(null, null, T0)).toBeNull();
  });
});

describe('shouldEndAbandoned', () => {
  const past = T0 - ABANDON_GRACE_MS - 1;

  it('ends a live debate whose room has been empty past the grace window', () => {
    expect(shouldEndAbandoned({ status: 'live', emptySinceMs: past, nowMs: T0 })).toBe(true);
  });

  it('waits while the room is still inside the grace window', () => {
    expect(
      shouldEndAbandoned({ status: 'live', emptySinceMs: T0 - 1_000, nowMs: T0 }),
    ).toBe(false);
  });

  it('leaves an occupied debate alone', () => {
    expect(shouldEndAbandoned({ status: 'live', emptySinceMs: null, nowMs: T0 })).toBe(false);
  });

  it('never cancels a debate nobody has arrived at yet', () => {
    // A scheduled debate has an empty room by definition.
    expect(shouldEndAbandoned({ status: 'scheduled', emptySinceMs: past, nowMs: T0 })).toBe(false);
  });

  it.each(['completed', 'cancelled', null] as const)(
    'leaves a %s debate alone',
    status => {
      expect(shouldEndAbandoned({ status, emptySinceMs: past, nowMs: T0 })).toBe(false);
    },
  );

  it('treats the exact grace boundary as reached', () => {
    expect(
      shouldEndAbandoned({ status: 'live', emptySinceMs: T0 - ABANDON_GRACE_MS, nowMs: T0 }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/debate/abandon-rules.test.ts`
Expected: FAIL — cannot resolve `./abandon-rules`.

- [ ] **Step 3: Implement `lib/debate/abandon-rules.ts`**

Export the three symbols above. Head the file with a comment in the house style explaining why it is pure (same split as `teardown-rules.ts`), and in particular why `participants: null` preserves rather than starts the clock.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/debate/abandon-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Revert-check the grace comparison**

Invert the grace comparison in `shouldEndAbandoned`, re-run, and confirm the boundary and inside-the-window tests both fail; then restore. Separately, weaken `>=` to `>` and confirm the boundary test alone fails. This proves the tests pin the behaviour and not just the shape.

- [ ] **Step 6: Commit**

```bash
git add lib/debate/abandon-rules.ts lib/debate/abandon-rules.test.ts
git commit -m "$(cat <<'EOF'
feat(debate): add the rules for ending an abandoned debate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Counting participants in a room

**Files:**
- Modify: `lib/livekit/room-service.ts`
- Test: `lib/livekit/room-service.test.ts` (create)

**Interfaces:**
- Produces: `countParticipants(roomName: string): Promise<number | null>` — the number in the room, `0` for a room LiveKit does not know, and `null` when LiveKit could not be asked at all. That three-way return is what `nextEmptySince` consumes.

- [ ] **Step 1: Write the failing tests**

Mock `livekit-server-sdk` with `vi.mock`, and `@/lib/env` so the client constructs. Three tests:

```ts
it('returns the number of participants in the room', /* listParticipants → 3 identities ⇒ 3 */);
it('reports a room LiveKit has never heard of as empty', /* rejects with a not-found ⇒ 0 */);
it('reports null when LiveKit cannot be reached at all', /* rejects with a network error ⇒ null */);
```

The not-found test must assert `0` and not `null`: rooms are created on first join, so a room that does not exist is a room nobody is in.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/livekit/room-service.test.ts`
Expected: FAIL — `countParticipants` is not exported.

- [ ] **Step 3: Implement `countParticipants` in `lib/livekit/room-service.ts`**

Call `getRoomService().listParticipants(roomName)` and return `.length`. Distinguishing not-found from unreachable is the one genuinely uncertain bit: inspect what the SDK rejects with (a `TwirpError`, typically carrying `code === 'not_found'`), and match on that rather than on the message text if a code is available. Log once at `console.warn` on the `null` path so an outage is visible; do not log the not-found path, which is routine.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/livekit/room-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/livekit/room-service.ts lib/livekit/room-service.test.ts
git commit -m "$(cat <<'EOF'
feat(livekit): count the participants in a debate room

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: One ending, shared by the route and the watcher

A refactor with no behaviour change, done before the watcher exists so the watcher has something correct to call. `POST /end` must behave exactly as it does today.

**Files:**
- Create: `lib/debate/end-debate.ts`
- Modify: `app/api/debates/[debateId]/end/route.ts`
- Test: `lib/debate/end-debate.test.ts` (create)

**Interfaces:**
- Consumes: `teardownDebateMedia` / `TeardownResult` (`lib/debate/teardown.ts`), `notifyDebateChanged` (`lib/debate/notify.ts`), `getPool` (`lib/db/pool.ts`), `EndOutcome` (`lib/debate/end-debate-state.ts`).
- Produces: `endDebate(debateId: string, outcome: EndOutcome): Promise<EndDebateResult | null>` where
  ```ts
  export interface EndDebateResult {
    /** The status now stored, or 'already ended' when the row was past ending. */
    status: EndOutcome | 'already ended';
    teardown: TeardownResult;
  }
  ```
  `null` means no such debate — the route maps that to 404.

- [ ] **Step 1: Write the failing tests**

Mock `@/lib/db/pool`, `@/lib/debate/teardown` and `@/lib/debate/notify`. Assert the sequence the current route performs:

```ts
it('writes the outcome, closes any running segment, tears down, then notifies');
it('tears down even when the row had already ended, and reports "already ended"');
it('returns null when no such debate exists');
it('never reports a status the UPDATE did not write');
```

The third test is what lets the route keep returning 404 rather than a misleading 200.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/debate/end-debate.test.ts`
Expected: FAIL — cannot resolve `./end-debate`.

- [ ] **Step 3: Move the body of the route's `POST` into `lib/debate/end-debate.ts`**

Lift the four statements verbatim — the status-guarded `UPDATE ... WHERE id = $1 AND status IN ('scheduled','live')`, the already-ended branch with its existence check, the `debate_segments` close, and `teardownDebateMedia` + `notifyDebateChanged`. Keep every comment: they record why the already-ended branch still tears down. Change nothing but the shape of the return.

- [ ] **Step 4: Rewire `app/api/debates/[debateId]/end/route.ts`**

The route keeps `runtime = 'nodejs'`, the moderator gate, and the body schema, then calls `endDebate`. `null` → 404 `{ error: 'Debate not found' }`. Everything else → `NextResponse.json(result)`, which preserves today's `{ status, teardown }` body.

- [ ] **Step 5: Run the full suite and the build**

Run: `npm test && npm run build`
Expected: PASS, with the suite's count up by the new tests and no other test changing. Run `git checkout next-env.d.ts` afterwards — the build rewrites it.

- [ ] **Step 6: Commit**

```bash
git add lib/debate/end-debate.ts lib/debate/end-debate.test.ts "app/api/debates/[debateId]/end/route.ts"
git commit -m "$(cat <<'EOF'
refactor(debate): extract the end sequence so there is one ending

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The watcher

**Files:**
- Create: `lib/debate/abandon-watch.ts`
- Modify: `instrumentation.ts`
- Modify: `CLAUDE.md` (the "Known gaps" bullet on egress outliving its debate)
- Test: `lib/debate/abandon-watch.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `nextEmptySince` / `shouldEndAbandoned` / `ABANDON_GRACE_MS`, Task 2's `countParticipants`, Task 3's `endDebate`, plus `getPool`.
- Produces:
  - `ABANDON_POLL_MS: number`
  - `sweepAbandonedDebates(nowMs?: number): Promise<{ checked: number; ended: string[] }>` — one pass, exported so tests drive it without timers.
  - `startAbandonWatch(): void` — idempotent; starts the interval if it is not already running.
  - `stopAbandonWatch(): void` — for tests.
  - `pendingAbandonClocks(): number` — the size of the clock map, for the leak test.

- [ ] **Step 1: Write the failing tests**

Mock `@/lib/db/pool`, `@/lib/livekit/room-service` and `@/lib/debate/end-debate`. Drive `sweepAbandonedDebates(nowMs)` directly, advancing `nowMs` by hand rather than using fake timers.

```ts
it('ends a live debate after two continuous minutes of an empty room');
it('does not end one that was still inside the grace window');
it('does not end one somebody rejoined before the window elapsed');
it('ends it as cancelled, never completed');       // assert endDebate called with 'cancelled'
it('keeps waiting rather than ending when LiveKit cannot be reached');  // Review Focus 1
it('runs one pass at a time when a tick outlasts the interval');        // Review Focus 2
it('forgets the clock for a debate that is no longer live');            // Review Focus 4
it('survives a boot with no LiveKit credentials');                      // Review Focus 3
```

For the re-entrancy test, make `countParticipants` return a promise you resolve by hand, call `sweepAbandonedDebates` twice without awaiting the first, and assert `countParticipants` was called once. For the leak test, sweep with a debate present, then sweep with the query returning `[]`, and assert `pendingAbandonClocks()` is 0. For the credentials test, have `countParticipants` reject and assert the pass resolves rather than throwing.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/debate/abandon-watch.test.ts`
Expected: FAIL — cannot resolve `./abandon-watch`.

- [ ] **Step 3: Implement `lib/debate/abandon-watch.ts`**

Module scope holds `Map<debateId, emptySinceMs>` and the interval handle, the same shape as `lib/transcription/registry.ts`. A pass:

```sql
SELECT id, status, livekit_room_name
  FROM listening.debates
 WHERE status = 'live'
```

filtered, never a scan. For each row, `countParticipants(room)` → `nextEmptySince` → `shouldEndAbandoned`; on true, `endDebate(id, 'cancelled')` and drop the clock entry. Delete clock entries for ids absent from the result so the map tracks only live debates. Guard the whole pass with a module-scope `running` flag. Wrap each debate's work so one failure does not abandon the rest of the pass, and wrap the pass itself so a throw never kills the interval.

Document, in the house style: why `cancelled` (Task 3's statuses), why the clock is in memory and what a redeploy costs, and the single-instance caveat in the same terms `expiry-registry.ts` uses.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/debate/abandon-watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Start it from `instrumentation.ts`**

Inside the existing `NEXT_RUNTIME === 'nodejs'` guard, dynamically import `./lib/debate/abandon-watch` and call `startAbandonWatch()`. Log one line on start. A failure here must not stop the server booting.

- [ ] **Step 6: Update the CLAUDE.md known-gaps bullet**

The bullet that begins "**An egress outlives its debate unless something stops it.**" gains a sentence: abandoned debates are now ended server-side by `lib/debate/abandon-watch.ts` once their LiveKit room has been empty for two minutes, and `sweepOrphanedEgress` remains the backstop for an egress whose debate row never said `live`. Keep the existing text; this is an addition, not a rewrite. Note that `CLAUDE.md` is CRLF — write the insertion with `\r\n`.

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npm test && npm run build`
Expected: all pass. `git checkout next-env.d.ts` afterwards.

- [ ] **Step 8: Commit**

```bash
git add lib/debate/abandon-watch.ts lib/debate/abandon-watch.test.ts instrumentation.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(debate): end a debate whose room has been empty for two minutes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Done when

- `npm run lint && npm test && npm run build` all pass.
- A PR against `master` describes the behaviour, the grace window, and the single-instance caveat, and notes that #76 will conflict in `instrumentation.ts` on rebase.
- After deploy, `/api/health` reports the merged commit, and a debate left with an empty room moves to `cancelled` within ~2.5 minutes without a browser involved.
