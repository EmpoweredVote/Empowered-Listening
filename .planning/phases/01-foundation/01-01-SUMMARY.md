---
phase: 01-foundation
plan: "01"
subsystem: database
tags: [postgres, supabase, migrations, rls, sql, listening-schema]

# Dependency graph
requires: []
provides:
  - listening Postgres schema with 9 v1 tables
  - RLS policies for all 9 tables
  - Supabase CLI scaffolding linked to kxsdzaojfaibhuzmclfq
  - Stub migration files for 116 existing remote EV platform migrations
affects:
  - 01-02 (LiveKit provisioning)
  - 01-03 (Next.js scaffold — needs pool.query for listening schema)
  - All Phase 2-6 plans (write to listening schema tables)

# Tech tracking
tech-stack:
  added: [supabase (CLI v2.75.0 via npm devDep)]
  patterns:
    - "auth.users(id) FK references for all user columns (not public.users)"
    - "All writes to listening schema via pool.query() or SECURITY DEFINER RPCs"
    - "RLS policies always specify TO authenticated/TO anon (never TO public)"
    - "(select auth.uid()) wrapping for index-safe RLS policies"
    - "Empty stub files for shared-instance migration history alignment"

key-files:
  created:
    - supabase/config.toml
    - supabase/.gitignore
    - supabase/migrations/20260420000000_create_listening_schema.sql
    - supabase/migrations/20260420000001_listening_rls_policies.sql
    - supabase/migrations/20260224000001_remote_ev_platform.sql (stub)
    - "... 115 more stub files for existing remote migrations"
    - .gitignore
    - package.json
  modified: []

key-decisions:
  - "FK references use auth.users(id) per architecture doc v3 (not public.users as onboarding doc example suggests)"
  - "fallacy_flags and summary_checks excluded from v1 foundation — deferred to Phase 5-6 feature implementation"
  - "116 empty stub migration files created to align supabase CLI history with shared EV instance"
  - "Moderator UPDATE policies deferred to Phase 2 SECURITY DEFINER RPCs when role slug is registered"
  - "Vote table uses (select auth.uid()) wrapping + partial unique index for null-target vote types"

patterns-established:
  - "Pattern: stub migration files for shared Supabase instance onboarding"
  - "Pattern: service-role-only writes (no public INSERT/UPDATE on core tables)"
  - "Pattern: debate content visibility gated on status IN (live, completed)"

# Metrics
duration: 14min
completed: 2026-04-20
---

# Phase 1 Plan 01: Database Migrations Summary

**`listening` Postgres schema with 9 v1 tables, RLS policies, and supabase CLI linked to shared EV instance kxsdzaojfaibhuzmclfq — ready for `db push`**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-20T20:36:59Z
- **Completed:** 2026-04-20T20:50:55Z (paused at Task 3 checkpoint)
- **Tasks:** 2/3 complete (Task 3 is a human-verify checkpoint)
- **Files modified:** 122

## Accomplishments

- Supabase CLI installed as devDependency, `supabase init` run, project linked to `kxsdzaojfaibhuzmclfq`
- Two migration files written with all 9 v1 tables (debates, debate_speakers, debate_segments, transcript_entries, notes, cx_wrap_up_events, votes, topic_proposals, speaker_performance), plus indexes and partial unique index for null-target votes
- RLS enabled on all 9 tables with policies matching observer/connected/empowered/moderator access rules
- 116 empty stub files created to align local migration history with existing remote EV platform migrations — required for `supabase db push --linked` to succeed

## Table Summary

| Table | Columns | FK to auth.users | Notes |
|-------|---------|------------------|-------|
| debates | 21 | created_by | status gate: live/completed for public read |
| debate_speakers | 9 | user_id | livekit_identity UNIQUE |
| debate_segments | 12 | — | UNIQUE(debate_id, sequence_order) |
| transcript_entries | 14 | edited_by | GIN full-text index + (debate_id, spoken_at) index |
| notes | 8 | user_id | CRUD for own rows; non-private readable by all |
| cx_wrap_up_events | 10 | — | Audit trail for CX wrap-up mechanic |
| votes | 10 | voter_id | UNIQUE + partial unique index for null target_id |
| topic_proposals | 9 | proposed_by | Moderator writes via service role |
| speaker_performance | 11 | user_id | Read-only post-debate; service role writes |

## RLS Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| debates | authenticated,anon (live/completed) | service role | service role | service role |
| debate_speakers | authenticated,anon (live/completed parent) | service role | service role | service role |
| debate_segments | authenticated,anon (live/completed parent) | service role | service role (Phase 2 RPC) | service role |
| transcript_entries | authenticated,anon (live/completed parent) | service role | service role (Phase 3 RPC) | service role |
| notes | own + non-private (authenticated) | own (authenticated) | own (authenticated) | own (authenticated) |
| cx_wrap_up_events | authenticated,anon (live/completed parent) | service role | service role | service role |
| votes | own (authenticated) | own (authenticated) | — (immutable) | — (immutable) |
| topic_proposals | authenticated,anon | service role | service role | service role |
| speaker_performance | authenticated,anon (completed parent) | service role | service role | service role |

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold supabase dir and link to remote** - `351548a` (feat)
2. **Task 2: Write migration files — 9 tables and RLS policies** - `48a7232` (feat)
3. **Task 2b: Stub migration files for remote EV platform history** - `92d4738` (chore)

**Plan metadata:** _(pending — will commit after Task 3 checkpoint approval)_

## Files Created/Modified

- `supabase/config.toml` - Supabase project config, project_id = "empowered-listening"
- `supabase/.gitignore` - Auto-generated by supabase init
- `supabase/migrations/20260420000000_create_listening_schema.sql` - listening schema + 9 tables + indexes
- `supabase/migrations/20260420000001_listening_rls_policies.sql` - RLS enable + policies for all 9 tables
- `supabase/migrations/20260224000001_remote_ev_platform.sql` through `20260418032359` - 116 empty stubs for shared-instance history alignment
- `.gitignore` - Root gitignore excluding secrets, tracking migrations
- `package.json` / `package-lock.json` - Minimal package with supabase devDep

## Decisions Made

**1. auth.users(id) vs public.users(id) for FK references**

The onboarding doc (2026-04-19) shows `public.users(id)` in its migration pattern example.  The architecture doc v3 (empowered-listening-architecture.md) uses `auth.users(id)` in all 9 table definitions and is the authoritative table definition source.  We follow `auth.users(id)` for v1.  This is documented at the top of the first migration file.

**2. fallacy_flags and summary_checks excluded from v1 foundation**

The plan's `must_haves` explicitly lists 9 tables.  `fallacy_flags` and `summary_checks` appear in the architecture doc but are not part of Phase 1-6 foundation scope.  They will be added in their respective feature phases (Phase 7 and Phase 8 per architecture doc §12).

**3. Stub migration files for shared instance history**

The `supabase db push --linked` command blocks when remote migration history has entries not present in the local directory.  The correct approach for joining an existing shared project is to create empty placeholder files for all existing remote migrations.  116 stubs were created, named `<version>_remote_ev_platform.sql`.  These are empty (no SQL) and serve only to align the CLI's history check.

**4. Moderator UPDATE policies deferred**

RLS update policies for debates/segments (moderator-only state transitions) are deferred to Phase 2 SECURITY DEFINER RPCs.  The Phase 1 migrations include a comment documenting this design intent.  All moderator writes currently go through service role (bypasses RLS).

**5. Votes table — null-target partial unique index**

The standard `UNIQUE(debate_id, voter_id, vote_type, target_id)` constraint cannot prevent duplicate votes when `target_id IS NULL` (Postgres `NULL != NULL`).  A partial unique index `WHERE target_id IS NULL` was added as documented in the architecture doc comment block on the votes table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created stub migration files for shared instance history alignment**

- **Found during:** Task 1/2 verification (`supabase db push --dry-run`)
- **Issue:** `supabase db push --linked` blocked with "Remote migration versions not found in local migrations directory" — 116 existing EV platform migrations not present locally
- **Fix:** Created 116 empty stub files named `<version>_remote_ev_platform.sql` — standard pattern for joining a shared Supabase project
- **Files modified:** 116 new empty files in `supabase/migrations/`
- **Verification:** `supabase migration list --linked` showed our two migrations as local-only (correct state before push)
- **Committed in:** `92d4738` (chore commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The stub files are required for `supabase db push --linked` to function.  No scope creep.

## Issues Encountered

**Supabase CLI direct DB connection requires DB password**

The `supabase link --project-ref kxsdzaojfaibhuzmclfq` succeeded via REST API without a password.  However, `supabase db push --linked` requires a direct Postgres connection (SCRAM-SHA-256 auth), which needs the Supabase DB password.  This is expected for a shared production instance — the CLI's "login role" mechanism failed with "Wrong password" in debug output.

The `db push` will succeed once the DB password is provided via:
```bash
supabase db push --linked --password <db-password>
```

The DB password is found at: Supabase Dashboard → Settings → Database → Database password.  Alternatively use the SQL editor in the dashboard to run the migration files directly.

## Next Phase Readiness

**Ready:**
- Migration files are version-controlled and reviewed
- Stub files ensure CLI history alignment
- All 9 tables designed to support Phase 2-6 requirements
- RLS policies follow security best practices

**Pending (Task 3 checkpoint):**
- `supabase db push --linked` must be run with DB password
- Dashboard verification of 9 tables + RLS in the `listening` schema
- Approval from Chris before proceeding to plans 01-02 through 01-04

**Open questions for Phase 2:**
- Moderator UPDATE RLS pattern: SECURITY DEFINER RPC vs service-role-only writes — needs a decision before implementing segment state transitions
- `listening_host` and `listening_moderator` role slugs must be registered with accounts maintainer before Phase 2 role-check patterns can be implemented

---

*Phase: 01-foundation*
*Completed: 2026-04-20 (Task 3 pending)*
