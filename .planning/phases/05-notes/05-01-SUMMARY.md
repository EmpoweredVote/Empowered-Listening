---
phase: 05-notes
plan: 01
subsystem: notes-foundation
tags: [postgres, rls, migration, dnd-kit, react-pdf, supabase]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: listening.notes table and initial RLS policies (notes_select_own_or_public, notes_insert_own, notes_update_own, notes_delete_own)
  - phase: 04-transcription
    provides: listening.transcript_entries table (FK target for source_transcript_entry_id)
provides:
  - listening.notes aligned with always-private design (is_private dropped)
  - Four new columns on listening.notes (updated_at, is_edited, rebuttal_order, source_transcript_entry_id)
  - Owner-only SELECT policy notes_select_own replacing notes_select_own_or_public
  - Partial index notes_rebuttal_order_idx for efficient rebuttal checklist queries
  - @dnd-kit/core@6.3.1, @dnd-kit/sortable@10.0.0, @dnd-kit/utilities@3.2.2 installed
  - @react-pdf/renderer@4.5.1 installed
affects: [05-02, 05-03, 05-04, 05-05]

# Tech tracking
tech-stack:
  added: [@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, @react-pdf/renderer]
  removed: []
  patterns:
    - "Policy-before-column-drop ordering: DROP POLICY before DROP COLUMN when policy references the column — Postgres will reject the column drop with 2BP01 otherwise"
    - "Partial index on nullable rebuttal_order (WHERE rebuttal_order IS NOT NULL) keeps index small as most notes have NULL order"

key-files:
  created:
    - supabase/migrations/20260427000000_notes_phase5.sql
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "DROP POLICY must precede DROP COLUMN when policy references that column — Postgres error 2BP01 enforces this ordering"
  - "Migration repair (supabase migration repair --status reverted) used to handle remote migration history drift between push attempts"
  - "No next.config.ts change needed — @react-pdf/renderer is on Next.js 15+ serverExternalPackages allowlist"

patterns-established:
  - "notes_select_own uses (select auth.uid()) = user_id form — consistent with all prior owner-only policies in listening schema"

migrations:
  added: [20260427000000_notes_phase5.sql]

# Metrics
duration: 4min
completed: 2026-04-27
---

# Phase 5 Plan 01: Notes Foundation Summary

**listening.notes aligned to always-private design: is_private dropped, four Phase 5 columns added, owner-only RLS policy created, and @dnd-kit + @react-pdf/renderer installed at pinned versions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-27T23:50:05Z
- **Completed:** 2026-04-27T23:54:17Z
- **Tasks:** 2
- **Files modified:** 3 (migration + package.json/lock)

## Accomplishments

- Applied migration 20260427000000_notes_phase5.sql to remote Supabase project; verified via psql that all 11 expected columns are present (is_private absent) and 4 expected RLS policies are in place (notes_select_own_or_public absent)
- Installed @dnd-kit/core@6.3.1, @dnd-kit/sortable@10.0.0, @dnd-kit/utilities@3.2.2, @react-pdf/renderer@4.5.1; `npm run build` passes clean
- Partial index notes_rebuttal_order_idx created for efficient rebuttal checklist queries

## Task Commits

Each task was committed atomically:

1. **Task 1: Write and apply Phase 5 notes schema migration** - `f48e46f` (feat)
2. **Task 2: Install @dnd-kit and @react-pdf/renderer** - `be4322f` (chore)

## Files Created/Modified

- `supabase/migrations/20260427000000_notes_phase5.sql` — Phase 5 schema correction: drop is_private + old policy, add 4 columns, create owner-only SELECT policy + partial rebuttal index
- `package.json` — Four new dependencies added under dependencies (not devDependencies)
- `package-lock.json` — Lock file updated with 66 new packages (dnd-kit + react-pdf trees)

## Decisions Made

- **DROP POLICY before DROP COLUMN:** Postgres requires this ordering when a policy references the column being dropped.  Discovered after first push attempt returned error 2BP01.  Migration reordered: policy drop first, then column drop.
- **Migration repair between attempts:** Used `supabase migration repair --status reverted 20260427000000` to reset failed push before re-applying corrected migration.  Same repair pattern as Phase 2 history alignment.
- **No next.config.ts change:** @react-pdf/renderer is already on Next.js serverExternalPackages allowlist; adding it manually would be redundant and could cause conflicts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reordered migration statements to drop policy before column**

- **Found during:** Task 1 (Write and apply Phase 5 notes schema migration)
- **Issue:** Migration as written dropped is_private column before dropping the notes_select_own_or_public policy, which references that column.  Postgres error 2BP01 ("cannot drop column because other objects depend on it") blocked the push.
- **Fix:** Reordered statements so `DROP POLICY` comes first (step 1), then `DROP COLUMN` (step 2).  Plan comment block header updated to match new ordering.  Migration re-applied after marking failed attempt as reverted via `migration repair`.
- **Files modified:** supabase/migrations/20260427000000_notes_phase5.sql
- **Verification:** Push succeeded; psql confirms is_private absent and notes_select_own_or_public absent.
- **Committed in:** f48e46f (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — statement ordering)
**Impact on plan:** Required fix; identical logical outcome to plan.  No scope change.

## Issues Encountered

- First `supabase db push` attempt returned error 2BP01 because the policy depended on the column being dropped.  Resolved by reordering migration statements and repairing migration history.
- `supabase db diff --schema listening` unavailable (requires Docker Desktop, which is not running in this environment) — verified migration outcome directly via psql query instead.

## User Setup Required

None — no external service configuration required.  Migration applied automatically; packages installed via npm.

## Next Phase Readiness

- listening.notes is ready for Phase 5 API and UI work.  All downstream plans (05-02 through 05-05) can import @dnd-kit and @react-pdf/renderer and read/write the updated schema.
- Plans 05-02 (notes API) and 05-03 (PDF export) can execute in parallel — both unblocked by this plan.
- No blockers.

---
*Phase: 05-notes*
*Completed: 2026-04-27*
