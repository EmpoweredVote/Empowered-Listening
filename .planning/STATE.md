# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** Phase 4 (Transcription) — 04-01, 04-02, 04-03 complete, ready for 04-04 (search/export)

## Current Position

Phase: 4 of 6 (Transcription) — in progress
Plan: 04-02 complete (3 of 4 plans in Phase 4 have summaries: 04-01, 04-02, 04-03)
Status: In progress (04-04 remains)
Last activity: 2026-04-23 — Completed 04-02-PLAN.md (transcription worker core: DeepgramLiveConnection, TranscriptionWorker, registry, API routes, lifecycle wiring)

Progress: [█████████████████░░░] 85% (17/20 plans complete)

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
  - [02-03]: JWT role claim extracted from app_metadata.roles first, top-level roles as fallback — Supabase standard is app_metadata.roles
  - [02-03]: Client-side role gate in CreateDebateForm (UX only); API always server-side protected; /moderator/* middleware deferred to follow-up
  - [02-03]: title and topic set to same value in createDebate (v1 known simplification)
  - [02-03]: NEXT_PUBLIC_APP_ORIGIN added to lib/env.ts as optional URL for share-page link generation
  - [02-04]: VideoTrack takes trackRef?: TrackReference; useTracks([Track.Source.Camera]) returns room-wide list, filter by participant.identity per tile
  - [02-04]: @livekit/components-styles imported in DebateRoom.tsx directly — not in globals.css; works because DebateRoom is a client component
  - [02-04]: Slot claim uses conditional UPDATE WHERE user_id IS NULL for atomic race-condition-safe claim
  - [03-01]: MUX_TOKEN_ID + MUX_TOKEN_SECRET required (z.string().min(1)) in env.ts — fail-fast at boot, not at debate start
  - [03-01]: Stream endpoint auth uses inline verifyToken (snapshot/route.ts pattern) — no new auth helper needed
  - [03-01]: Dynamic imports used in segment route for egress path — lazy loading keeps hot path free of egress import cost
  - [03-01]: reconnect_window: 0 on Mux live stream — prevents phantom reconnection after debate ends
  - [03-01]: Belt-and-suspenders idempotency: DB livekit_egress_id null check + listEgress({active:true}) before startRoomCompositeEgress
  - [03-01]: mux_stream_key nulled immediately after egress starts — RTMP ingest credential does not persist in DB
  - [03-01]: Mux free plan blocks live RTMP ingest — Task 4 verification deferred pending Mux Growth plan upgrade (nonprofit discount request submitted)
  - [03-01]: Stream endpoint auth uses inline verifyToken (JWT decode, snapshot/route.ts pattern) — no separate requireUserFromRequest helper needed
  - [03-02]: Stream endpoint made anonymous — verifyToken removed; service-role pool status gate added inline in SQL (not relying on RLS alone)
  - [03-02]: SQL status gate explicit (AND status IN ('live', 'completed')) — service role bypasses RLS, so gate must be in query
  - [03-02]: 404 returns 'Debate not available' for both missing and wrong-status debates — no info leak about scheduled/cancelled debates
  - [03-02]: lowLatencyMode: false in hls.js — Mux 'reduced' latency is standard HLS; lowLatencyMode: true would misinterpret manifests
  - [03-02]: Direct hls.js import (not dynamic import) — 'use client' directive already isolates component to client bundle
  - [03-02]: HlsPlayer parent contract: mount only when src available (status=live AND mux_playback_id non-null) — hls.js does not retry on 404
  - [03-03]: Observer snapshot endpoint gates on SQL WHERE clause (not middleware/RLS) — service-role pool bypasses RLS, so gate must be in query
  - [03-03]: useObserverDebateSync does NOT call setAuth() — migration 20260421000002 confirmed anon role on all three listening tables
  - [03-03]: SegmentTimeline renders LD_SEGMENTS placeholder pills when store is empty — prevents flash of empty layout before first snapshot
  - [03-03]: Observer channel name `observer-debate-${debateId}` distinct from participant `debate-${debateId}` — prevents collision edge case
  - [03-04]: react-resizable-panels v4 renamed exports: Group/Panel/Separator (not PanelGroup/PanelResizeHandle); orientation prop (not direction)
  - [03-04]: autoSaveId prop removed in v4 — useDefaultLayout({ id }) hook replaces it; returns defaultLayout + onLayoutChanged for Group
  - [03-04]: videoContainerRef is a div wrapper; querySelector('video') used to reach HTMLVideoElement for Space key play/pause
  - [03-04]: /debates/[debateId] route is fully anonymous — no auth gate; middleware.ts desktop gate only covers /join/* paths
  - [03-05]: @custom-variant block-form required in Tailwind v4.2.2 — short-form (@custom-variant NAME (@media CONDITION);) rejected by PostCSS with CssSyntaxError
  - [03-05]: CSS portrait:/landscape: classes work after @custom-variant block-form declarations — no JS window.matchMedia fallback needed
  - [03-05]: HlsPlayer is default export (export default function HlsPlayer) — use import HlsPlayer from './HlsPlayer', not named import
  - [04-01]: DEEPGRAM_API_KEY uses z.string().min(1) — same fail-fast pattern as MUX_TOKEN_ID; server refuses to start without it
  - [04-01]: worker role: canPublish=false, canPublishData=false, roomAdmin=false — subscribe-only LiveKit token; identity convention is `transcription-worker:${debateId}`
  - [04-01]: computeDebateTimeMmss uses wall-clock difference NOT Deepgram word.start timestamps — avoids reset-on-reconnect bugs
  - [04-01]: vitest/globals triple-slash reference in test files — preferred over tsconfig types array (avoids restricting Next.js type auto-discovery)
  - [04-03]: TranscriptPanel uses allocated_seconds (not duration_seconds) — matches DebateSegmentRow and DB column; plan interface had wrong field name
  - [04-03]: GET transcript endpoint gates on debate existence only (not status) — transcript is public civic record, accessible regardless of debate status
  - [04-03]: Broadcast-ephemeral pattern: load DB snapshot via GET first, then subscribe — useTranscriptSync handles subscription only, not initial load
  - [04-03]: speakersMap and segmentsArray built inline in each layout from useDebateStore — no prop drilling through ObserverShell needed
  - [04-03]: Segment display name derived from LD_SEGMENTS lookup at module level — not stored in DB
  - [04-02]: Deepgram SDK v5 API: DefaultDeepgramClient (not createClient); listen.v1 is a getter property; connect() is async returning V1Socket; sendMedia() not send(); close() not finish()
  - [04-02]: V5 SDK boolean params require string literals 'true'/'false' for interim_results, smart_format, punctuate; filler_words passed via extra query param
  - [04-02]: export const runtime = 'nodejs' required on routes importing @livekit/rtc-node native bindings
  - [04-02]: RoomOptions requires dynacast: false alongside autoSubscribe: true for subscriber-only worker token

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.
- [01-01]: 116 stub migration files were created to align local Supabase history with existing remote EV platform migrations — these stubs will appear in future migration lists.  This is expected; the listening migrations are 20260420000000 and 20260420000001.
- [RESOLVED - 02-02]: Moderator role question resolved — mintToken uses role='moderator' for roomAdmin grant; listening_host/listening_moderator slugs are the role identifiers.
- [RESOLVED - 02-02]: LD segment schedule definitive — 7 segments, 1920 total speaking seconds (32 min), LD_SEGMENTS in lib/debate/segments.ts is canonical.
- [02-03 follow-up]: /moderator/* Next.js middleware not yet added — client-side gate only in v1; add before production launch.
- [03-01 deferred]: Live pipeline verification (Task 4) not yet run — Mux Growth plan required for RTMP ingest.  Also confirm 'reduced' vs 'low' latency_mode once live testing is possible.

## Session Continuity

Last session: 2026-04-23T14:30:54Z
Stopped at: 04-02-PLAN.md complete; transcription worker core (DeepgramLiveConnection, TranscriptionWorker, registry, API routes, lifecycle wiring) delivered
Resume file: None — proceed to 04-04 (transcript search and export)
