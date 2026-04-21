---
plan: 02-06
phase: 02-speaker-room
status: complete
---

# 02-06 Summary: Server Debate Engine

## What Was Built

- **`lib/supabase/admin.ts`** — Service-role Supabase client factory (`getSupabaseAdmin`).  Cached singleton.  Used exclusively for calling SECURITY DEFINER RPCs via `admin.schema('listening').rpc(...)`.
- **`lib/debate/transitions.ts`** — Typed wrappers over all 6 SECURITY DEFINER RPCs from plan 02-01: `startSegment`, `endSegment`, `repeatSegment`, `startPrepTime`, `endPrepTime`, `consumeBonusTime`.  All route through a single `callRpc<T>` helper that throws on Supabase error.
- **`lib/debate/mic-control.ts`** — `applySegmentMicPermissions(debateId, segmentId)` reads segment type + all speakers + room name from DB, maps `LDSegment.activeSpeakerRole` to affirmative/negative canPublish booleans, and calls `setMicPermission` via `Promise.allSettled` (transient failure on one speaker does not block the other).  `handleBonusExhaustion(debateId, speakerId)` forces `canPublish=false` when a speaker's bonus pool hits zero.
- **`app/api/debates/[debateId]/segments/[segmentId]/route.ts`** — POST handler for `{ action: 'start' | 'end' | 'repeat' }`.  Requires moderator JWT.  `start` and `repeat` call RPC then `applySegmentMicPermissions`.  `end` calls RPC then revokes both speakers' `canPublish` via inline `Promise.allSettled`.
- **`app/api/debates/[debateId]/prep/route.ts`** — POST handler for `{ action: 'start' | 'end', speakerId, prepSecondsRequested? }`.  Caller must be authenticated (JWT); RPC re-verifies moderator or target speaker.  Finds the active/paused segment by query, delegates to `startPrepTime` or `endPrepTime`.

## Commit History

- `544da8a` feat(02-06): add supabaseAdmin client, RPC wrappers, and mic-control helpers
- `4e83973` feat(02-06): add segment transition API route
- `3fcb02d` feat(02-06): add prep time API route

## Deviations

None.  Plan followed exactly.

## Known Gaps / Follow-up

- **Client-driven auto-expire**: When a segment's `end_time` elapses, the timer hits zero on all clients but no segment transition happens automatically.  The moderator must manually call `POST .../segments/[id]` with `{ action: 'end' }`, OR the moderator UI (02-07) can fire it automatically when `computeRemainingMs()` reaches zero.  This is a 02-07 concern.
- **`consumeBonusTime` call site**: The `consumeBonusTime` RPC wrapper exists in `transitions.ts` but is not wired to any HTTP endpoint yet.  It should be called when bonus time is running (timer has expired but bonus pool is positive).  This is also a 02-07 concern (the moderator/timer UI decides when to call it).
