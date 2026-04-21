---
phase: 02-speaker-room
plan: "01"
subsystem: database
tags: [postgres, supabase, migrations, rls, realtime, security-definer, listening-schema]

requires:
  - phase: 01-foundation
    provides: listening schema with 9 v1 tables, RLS policies, supabase CLI linked to kxsdzaojfaibhuzmclfq
provides:
  - end_time, prep_time_end_time, paused_remaining_seconds columns on debate_segments
  - prep_time_seconds (DEFAULT 240) column on debate_speakers
  - Supabase Realtime enabled for debates, debate_segments, debate_speakers (REPLICA IDENTITY FULL + publication)
  - Participant-visibility RLS policies for scheduled debates (unblocks snapshot fetch + Realtime + token mint)
  - 6 SECURITY DEFINER RPCs: start_segment (sequence-enforced), end_segment, repeat_segment, start_prep_time (pause snapshot), end_prep_time (faithful restore), consume_bonus_time
affects:
  - 02-03 (createDebate seeds 7 debate_segments rows; start_segment RPC used in 02-06)
  - 02-04 (token endpoint reads debate_speakers; RLS allows scheduled-debate participants to read)
  - 02-05 (Realtime subscriptions on debate_segments, debate_speakers, debates)
  - 02-06 (calls start_segment, end_segment, repeat_segment, start_prep_time, end_prep_time, consume_bonus_time RPCs)

tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER + SET search_path = '' on all state-transition RPCs — moderator identity verified inside each function"
    - "paused_remaining_seconds pattern: start_prep_time snapshots remaining seconds; end_prep_time restores as NOW() + snapshot (faithful pause/resume, not full reset)"
    - "Sequence enforcement in start_segment: rejects unless target = 1 with no completed, or target = max(completed)+1"
    - "DROP POLICY IF EXISTS + CREATE POLICY pattern for idempotent RLS amendments"
    - "ALTER PUBLICATION supabase_realtime ADD TABLE with --include-all flag required when migrations predate last remote migration"

key-files:
  created:
    - supabase/migrations/20260421000000_speaker_room_schema.sql
    - supabase/migrations/20260421000001_speaker_room_rpcs.sql
    - supabase/migrations/20260421013004_remote_ev_platform.sql
  modified: []

key-decisions:
  - "paused_remaining_seconds stores main-timer snapshot at prep-start; end_prep_time restores end_time = NOW() + snapshot (not full allocated reset)"
  - "start_segment enforces sequence_order: target must be 1 (no completed) or max(completed)+1 — prevents skipping per DEBATE-04"
  - "prep_time_seconds DEFAULT 240 per debate_speaker (4-minute pool per speaker, standard LD format)"
  - "participant-visibility RLS uses auth.uid() wrapped in (select auth.uid()) for index compatibility"
  - "GRANT SELECT on listening tables to authenticated required for Realtime postgres_changes to filter by debate_id"

patterns-established:
  - "Pattern: stub migration file required when local migrations predate last remote migration + --include-all flag for db push"
  - "Pattern: SECURITY DEFINER RPC with SET search_path = '' + GRANT EXECUTE TO authenticated for all state-transition functions"

duration: ~20min
completed: 2026-04-21
---

# Phase 02-01: Schema Extensions + SECURITY DEFINER RPCs Summary

**Four Phase 2 timer columns added, Supabase Realtime enabled for 3 tables, participant-visibility RLS amended, and 6 SECURITY DEFINER RPCs created with sequence enforcement and faithful prep pause/resume**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-04-21
- **Tasks:** 3/3 complete (Task 3 = human-verified migration push)
- **Files modified:** 3

## Accomplishments

- Four columns added to `listening` schema: `end_time` and `prep_time_end_time` (timestamptz) on `debate_segments`; `paused_remaining_seconds` (integer, nullable) on `debate_segments`; `prep_time_seconds` (integer DEFAULT 240) on `debate_speakers`
- Supabase Realtime enabled for `debates`, `debate_segments`, `debate_speakers` — REPLICA IDENTITY FULL + GRANT SELECT to authenticated + added to `supabase_realtime` publication
- RLS extended: participant-visibility policies replace Phase 1 public-only policies, allowing debate participants to SELECT their own scheduled debate before it goes live
- 6 SECURITY DEFINER RPCs with moderator-identity verification, sequence enforcement (DEBATE-04), and faithful prep pause/resume via `paused_remaining_seconds` snapshot

## Task Commits

1. **Task 1: Schema additions, Realtime enablement, participant-visibility RLS** - `5466aee` (feat)
2. **Task 2: SECURITY DEFINER RPC migration** - `86cf9e9` (feat)
3. **Auto-fix: Stub migration for remote history alignment** - `4740a92` (chore)

**Plan metadata:** _(docs commit — this summary)_

## Files Created/Modified

- `supabase/migrations/20260421000000_speaker_room_schema.sql` — 4 ADD COLUMN IF NOT EXISTS, 3 GRANT SELECT, 3 REPLICA IDENTITY FULL, 3 ALTER PUBLICATION, 3 CREATE POLICY
- `supabase/migrations/20260421000001_speaker_room_rpcs.sql` — 6 SECURITY DEFINER functions + 6 GRANT EXECUTE TO authenticated
- `supabase/migrations/20260421013004_remote_ev_platform.sql` — empty stub for remote history alignment

## Decisions Made

**1. paused_remaining_seconds for faithful prep pause/resume**
When prep time is called during an active segment, `start_prep_time` snapshots the main segment timer's remaining seconds into `paused_remaining_seconds` and sets `end_time = NULL`.  When prep ends, `end_prep_time` restores `end_time = NOW() + paused_remaining_seconds` — the speaker resumes with exactly the time they had left, not a full reset.

**2. Sequence enforcement in start_segment**
`start_segment` rejects calls where the target segment's `sequence_order` is not the expected next value.  Valid starts: `sequence_order = 1` with no completed segments, or `sequence_order = max(completed) + 1`.  `repeat_segment` is exempt (re-activates same segment).  This implements DEBATE-04 at the database layer.

**3. prep_time_seconds per debate_speaker (not per debate)**
Standard LD: 4 minutes per speaker, independent pools.  Stored on `debate_speakers` rather than `debates` so future formats with unequal prep allocation are supported without schema changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Remote migration 20260421013004 not present locally**
- **Found during:** Task 3 (supabase db push)
- **Issue:** A new remote migration appeared since Phase 1 stubs were created; CLI blocked with "Remote migration versions not found in local migrations directory"
- **Fix:** Created empty stub `supabase/migrations/20260421013004_remote_ev_platform.sql`; re-ran push with `--include-all` flag (required because Phase 2 migrations predate the new remote migration timestamp)
- **Files modified:** `supabase/migrations/20260421013004_remote_ev_platform.sql`
- **Committed in:** `4740a92`

---

**Total deviations:** 1 auto-fixed (1 blocking — new remote migration stub)
**Impact on plan:** Required for db push to succeed.  No scope creep.

## Issues Encountered

**Remote migration timestamp ordering**
The two Phase 2 migrations (`20260421000000`, `20260421000001`) were timestamped before the remote stub `20260421013004`.  Supabase CLI required the `--include-all` flag to apply out-of-order local migrations.  This is expected when a shared instance receives migrations between local development sessions.

## Next Phase Readiness

**Ready for 02-02 (already complete in Wave 1 parallel execution)**
- All 4 Phase 2 timer columns exist on remote
- All 6 RPCs callable with moderator-identity enforcement
- Supabase Realtime will fire `postgres_changes` on the three broadcast tables
- Authenticated participants can SELECT scheduled debates via updated RLS

**Open follow-ups:**
- Prep-seconds-used accounting in `end_prep_time` is approximate for early stops (v1 conservatively decrements 0).  A follow-up adding `prep_time_start` timestamp to `debate_segments` would yield exact accounting.

---
*Phase: 02-speaker-room*
*Completed: 2026-04-21*
