# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 0 of 4 in current phase
Status: Ready to plan
Last activity: 2026-04-19 — Roadmap created; all 34 v1 requirements mapped across 6 phases

Progress: [░░░░░░░░░░] 0%

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 1]: Open question — is "moderator" a distinct role from Empowered, or an attribute on an Empowered account?  Resolve before Phase 2 JWT token minting.
- [Pre-Phase 2]: Lincoln-Douglas total time is 32 minutes of segments vs 45 stated in design doc; 13-minute delta needs a definitive segment schedule before Phase 2 timer implementation.
- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.

## Session Continuity

Last session: 2026-04-19
Stopped at: Roadmap created; STATE.md and REQUIREMENTS.md traceability written
Resume file: None
