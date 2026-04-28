---
phase: 05-notes
plan: 02
subsystem: notes-api
tags: [notes, crud, api, zustand, jwt, zod, postgres, tier-gate, ownership]

# Dependency graph
requires:
  - phase: 05-01
    provides: listening.notes table with updated_at, is_edited, rebuttal_order columns; migration applied

provides:
  - GET /api/debates/[debateId]/notes — owner-scoped list (user_id filtered, Cache-Control: no-store)
  - POST /api/debates/[debateId]/notes — create note, Connected/Empowered tier only, 403 for Inform
  - PUT /api/debates/[debateId]/notes/[noteId] — edit content, sets is_edited=true + updated_at=NOW()
  - DELETE /api/debates/[debateId]/notes/[noteId] — remove own note, 204 on success
  - PUT /api/debates/[debateId]/notes/[noteId]/reorder — atomically writes rebuttal_order via transaction
  - lib/auth/connected.ts — requireConnectedTier() + mapTierError() helpers
  - store/notesStore.ts — useNotesStore with NoteRow, all CRUD + reorder + checked actions

affects: [05-04, 05-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireConnectedTier(bearer) + mapTierError(err) pattern for tier-gated routes"
    - "Ownership enforced via WHERE user_id = $N in every SQL mutation — never leaks other users' data"
    - "404 for both 'not found' and 'not yours' — no ownership info leaked"
    - "Reorder via VALUES list + FROM clause in single transaction (BEGIN/COMMIT/ROLLBACK via pool.connect())"
    - "NoteRow type exported from route and mirrored exactly in Zustand store"
    - "checkedIds as ephemeral Record<string, boolean> in Zustand — never persisted"

key-files:
  created:
    - app/api/debates/[debateId]/notes/route.ts
    - app/api/debates/[debateId]/notes/[noteId]/route.ts
    - app/api/debates/[debateId]/notes/[noteId]/reorder/route.ts
    - store/notesStore.ts
    - lib/auth/connected.ts
  modified: []

key-decisions:
  - "requireConnectedTier calls getAccountMe(accessToken) directly in route handler context — cache() wrapper is React-RSC-specific but harmless in non-RSC contexts"
  - "mapTierError converts TierError (subclass with .code) into { status, body } so routes return uniform error shapes"
  - "DELETE has no tier check — users can always remove their own data regardless of tier"
  - "Reorder route validates full orderedIds ownership before opening transaction (ANY($3::uuid[]) count check)"
  - "reorderNotes in store keeps notes not in orderedIds appended sorted by created_at — preserves timeline notes outside rebuttal list"
  - "NoteRow.is_checked intentionally absent — checked state lives in checkedIds Record on store only"

patterns-established:
  - "Pattern: requireConnectedTier(bearer) + mapTierError(err) for any route requiring Connected tier"
  - "Pattern: getUserIdFromRequest(req) returns null on any auth failure; caller decides 401 vs continue"
  - "Pattern: NoteRow type exported from route.ts and imported by store — single source of truth for shape"

# Metrics
duration: 4min
completed: 2026-04-28
---

# Phase 5 Plan 02: Notes API + Zustand Store Summary

**Five-file notes CRUD surface: three route handlers with JWT/tier/ownership gates, one Zustand store with NoteRow matching API shape, and a reusable requireConnectedTier helper**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-27T23:57:34Z
- **Completed:** 2026-04-28T00:01:28Z
- **Tasks:** 3
- **Files created:** 5

## Accomplishments

- Full note CRUD API: GET (owner-only list), POST (tier-gated create), PUT (edit with is_edited flag), DELETE (no-tier remove), reorder (atomic transaction)
- Connected-tier gate via `requireConnectedTier()` and `mapTierError()` — reusable across all write routes in Phase 5
- Zustand `useNotesStore` with NoteRow type structurally identical to API shape; `checkedIds` map is ephemeral client-only state

## Task Commits

Each task was committed atomically:

1. **Task 1: Connected-tier helper + GET/POST notes route** - `81440b8` (feat)
2. **Task 2: PUT/DELETE single-note + reorder route** - `f3b9e6e` (feat)
3. **Task 3: Zustand notes store** - `34343fd` (feat)

**Plan metadata:** (added in final commit below)

## Files Created/Modified

- `lib/auth/connected.ts` — requireConnectedTier() checks tier/standing via getAccountMe(); mapTierError() converts TierError to uniform HTTP response shape
- `app/api/debates/[debateId]/notes/route.ts` — GET (owner-scoped, no-store) + POST (Connected tier, zod body validation); exports NoteRow type
- `app/api/debates/[debateId]/notes/[noteId]/route.ts` — PUT (is_edited + updated_at) + DELETE (tier-free); 404 for both not-found and not-owned
- `app/api/debates/[debateId]/notes/[noteId]/reorder/route.ts` — PUT with ownership count check + atomic VALUES-list transaction
- `store/notesStore.ts` — useNotesStore with all actions; NoteRow exported; checkedIds ephemeral

## Decisions Made

- `requireConnectedTier` calls `getAccountMe()` directly from a route handler (not RSC); React's `cache()` wrapper is a no-op outside RSC but harmless
- DELETE route has no tier check — removing your own data is always permitted regardless of account tier
- `404` is returned for both "note doesn't exist" and "note belongs to someone else" — prevents ownership info leak
- Reorder ownership validated before transaction via `ANY($3::uuid[])` count check — fail fast before acquiring connection
- Store's `reorderNotes` keeps notes not in orderedIds appended at end sorted by `created_at` — supports timeline notes that are not in the rebuttal list

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All five API endpoints compile and are registered in the Next.js route table
- `NoteRow` type is exported from `route.ts` and matches the store type exactly — UI plans (05-04, 05-05) can import from either
- `requireConnectedTier` + `mapTierError` are importable by any future routes that need the Connected tier gate
- 05-04 (observer notes UI) and 05-05 (speaker rebuttal checklist) can now build against these endpoints

---
*Phase: 05-notes*
*Completed: 2026-04-28*
