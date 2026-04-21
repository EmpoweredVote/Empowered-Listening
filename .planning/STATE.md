# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 4 of 4 in current phase
Status: In progress (checkpoint — awaiting human verification)
Last activity: 2026-04-21 — Tasks 1-2 of 01-04-PLAN.md complete; Task 3 checkpoint pending SSO verification

Progress: [████░░░░░░░░░░░░░░░] 21% (4/19 plans in progress)

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
- [Arch]: Switched from Cloudflare Workers/Stream/R2 to Render/Mux/S3 — empowered.vote DNS is on AWS/GoDaddy, incompatible with Cloudflare Workers custom domains
- [01-02]: Switched from Cloudflare Stream/R2/Workers to Mux/S3/Render — empowered.vote DNS on AWS/GoDaddy is incompatible with Cloudflare Workers custom domains
  - [01-03]: EV-UI fallback tokens used directly in tailwind.config.ts — @empoweredvote/ev-ui preset not imported
  - [01-04]: jose createRemoteJWKSet with algorithms: ['ES256'] enforced — prevents algorithm confusion attacks
  - [01-04]: Desktop gate passes x-mobile-gate: 1 header (not redirect) — inline gate on same page per decision
  - [01-04]: assertBypassSafe() called at layout module level — runs at startup, not per-request
  - [01-04]: SessionProvider uses localStorage (ev_token) + cookie-based silent renewal via api.empowered.vote

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 1]: Open question — is "moderator" a distinct role from Empowered, or an attribute on an Empowered account?  Resolve before Phase 2 JWT token minting.
- [Pre-Phase 2]: Lincoln-Douglas total time is 32 minutes of segments vs 45 stated in design doc; 13-minute delta needs a definitive segment schedule before Phase 2 timer implementation.
- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.
- [01-01]: 116 stub migration files were created to align local Supabase history with existing remote EV platform migrations — these stubs will appear in future migration lists.  This is expected; the listening migrations are 20260420000000 and 20260420000001.
- [Pre-Phase 2]: listening_host and listening_moderator role slugs registered (01-02 complete) — role-check patterns can proceed in Phase 2.

## Session Continuity

Last session: 2026-04-21
Stopped at: 01-04 Task 3 checkpoint — awaiting human SSO verification (tasks 1-2 committed at aac535e, 3e32282)
Resume file: None (resume signal: "01-04 approved")
