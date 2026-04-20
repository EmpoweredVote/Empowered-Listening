# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 0.5 of 4 in current phase (01-01 paused at Task 3 checkpoint)
Status: Checkpoint — awaiting human verify before db push
Last activity: 2026-04-20 — Tasks 1-2 of 01-01 complete; paused at Task 3 (db push + dashboard verify)

Progress: [█░░░░░░░░░] 4% (1 plan in progress, 0 complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: Schema name is `listening` (onboarding doc 2026-04-19 is authoritative over Feb architecture doc)
- [Init]: All writes to `listening` schema use pool.query() or SECURITY DEFINER RPCs — PostgREST does not expose non-public schemas
- [Init]: SSO only via accounts.empowered.vote; JWT verified ES256 via JWKS; never set SUPABASE_JWT_SECRET
- [Init]: Speaker/moderator UI is desktop-only in v1; mobile attempts get clean rejection message
- [01-01]: FK references use auth.users(id) per architecture doc v3 (onboarding doc example uses public.users — architecture doc wins for v1)
- [01-01]: fallacy_flags and summary_checks excluded from v1 foundation — deferred to Phase 7/8 feature implementation
- [01-01]: Stub migration files (empty SQL) required for shared-instance CLI history alignment — 116 stubs created for existing EV platform migrations
- [01-01]: Moderator UPDATE RLS policies deferred to Phase 2 SECURITY DEFINER RPCs; service role handles all writes in Phase 1

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 1]: Open question — is "moderator" a distinct role from Empowered, or an attribute on an Empowered account?  Resolve before Phase 2 JWT token minting.
- [Pre-Phase 2]: Lincoln-Douglas total time is 32 minutes of segments vs 45 stated in design doc; 13-minute delta needs a definitive segment schedule before Phase 2 timer implementation.
- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.
- [01-01 ACTIVE]: Task 3 checkpoint — must run `supabase db push --linked --password <db-password>` and verify 9 tables in dashboard before 01-01 is complete.  DB password at: Supabase Dashboard → Settings → Database.
- [Pre-Phase 2]: listening_host and listening_moderator role slugs must be registered with accounts maintainer before role-check patterns can be implemented.

## Session Continuity

Last session: 2026-04-20T20:50:55Z
Stopped at: 01-01 Task 3 checkpoint — `supabase db push --linked` needs DB password; Tasks 1+2 committed
Resume file: None
