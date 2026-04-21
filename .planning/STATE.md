# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** Phase 2 — Speaker Room

## Current Position

Phase: 2 of 6 (Speaker Room)
Plan: 02-01 and 02-02 complete (Wave 1, 2 of 7 in current phase)
Status: In progress
Last activity: 2026-04-21 — Completed 02-01-PLAN.md and 02-02-PLAN.md (Wave 1 complete)

Progress: [█████░░░░░░░░░░░░░░] 26% (5/19 plans complete)

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
  - [01-04]: account_standing checked in server components via x-user-id header — not in middleware (avoids per-request outbound API call on every route)
  - [02-02]: LIVEKIT_* env vars are optional() in Zod schema — prevents startup failures in dev environments without LiveKit configured
  - [02-02]: mintToken must await toJwt() — livekit-server-sdk v2 made toJwt() async; unwrapped Promise is rejected as malformed by LiveKit
  - [02-02]: setMicPermission uses updateParticipant (not mutePublishedTrack) — canPublish revocation auto-unpublishes all tracks, no track SID needed
  - [02-01]: paused_remaining_seconds stores main-timer snapshot; end_prep_time restores faithfully (not full reset)
  - [02-01]: start_segment enforces sequence order — target must be 1 (no completed) or max(completed)+1 per DEBATE-04
  - [02-01]: Remote migration timestamp ordering requires --include-all flag when Phase 2 migrations predate new remote stubs

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.
- [01-01]: 116 stub migration files were created to align local Supabase history with existing remote EV platform migrations — these stubs will appear in future migration lists.  This is expected; the listening migrations are 20260420000000 and 20260420000001.
- [RESOLVED - 02-02]: Moderator role question resolved — mintToken uses role='moderator' for roomAdmin grant; listening_host/listening_moderator slugs are the role identifiers.
- [RESOLVED - 02-02]: LD segment schedule definitive — 7 segments, 1920 total speaking seconds (32 min), LD_SEGMENTS in lib/debate/segments.ts is canonical.

## Session Continuity

Last session: 2026-04-21
Stopped at: Completed 02-02-PLAN.md — runtime deps + server-side primitives complete
Resume file: None
