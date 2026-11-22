# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.
**Current focus:** One verification sitting stands between here and five phases closed.  Three of the four known gaps are shut — the Mux pipeline is verified (2026-11-17), segments expire server-side, and the bonus pool actually depletes.  What is left is the `/moderator/*` middleware gate, issue #100, and the sitting itself.

## Current Position

Phase: 5 of 6 (Notes) — code complete, not verified
Plan: 05-05 Tasks 1-2 complete (5 of 5 plans in Phase 5 delivered)
Status: Phase 5 code complete — 05-01 … 05-05 shipped.  **05-05 Task 3, the human-verify gate, has not been run**, so the phase is not closed.  It is not blocked: it needs a sitting with three browser roles, which has been possible since the Phase 2 E2E and is doubly so now that the video pipeline is verified.
Last activity: 2026-11-22 — PRs #75 (bonus pool depletes), #76 (server-side segment expiry) and #115 (seven review findings) merged; 7365bf2 live on Render at 04:44 with a clean boot.  ev-infra#12 registers `SEGMENT_EXPIRY`.

Progress: [█████████████████████████] code — [░░░░░░░░░░] verification (Task 3 outstanding)

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
- [2026-08-27 / PR #18]: verifyToken accepts two issuers (ev-accounts decision 0002) — Supabase ES256 (aud 'authenticated', userId from sub) and WorkOS AuthKit RS256 (no aud claim, requires role='authenticated', userId from external_id and NEVER the WorkOS sub).  Unset WORKOS_CLIENT_ID disables the WorkOS branch.  WORKOS_ISSUER and WORKOS_JWKS_URL are optional overrides read straight from process.env; they are not in the lib/env.ts Zod schema, so a typo fails at verify time rather than at boot
- [Init]: Speaker/moderator UI is desktop-only in v1; mobile attempts get clean rejection message
- [01-01]: FK references use auth.users(id) per architecture doc v3 (onboarding doc example uses public.users — architecture doc wins for v1)
- [01-01]: fallacy_flags and summary_checks excluded from v1 foundation — deferred to Phase 7/8 feature implementation
- [01-01]: Stub migration files (empty SQL) required for shared-instance CLI history alignment — 116 stubs created for existing EV platform migrations
- [01-01]: Moderator UPDATE RLS policies deferred to Phase 2 SECURITY DEFINER RPCs; service role handles all writes in Phase 1
- [Arch]: Switched from Cloudflare Workers/Stream/R2 to Render/Mux/S3 — empowered.vote DNS is on AWS/GoDaddy, incompatible with Cloudflare Workers custom domains
- [01-02]: Switched from Cloudflare Stream/R2/Workers to Mux/S3/Render — empowered.vote DNS on AWS/GoDaddy is incompatible with Cloudflare Workers custom domains
  - [01-03]: EV-UI fallback tokens used directly in tailwind.config.ts — @empoweredvote/ev-ui preset not imported
  - [01-04]: jose createRemoteJWKSet with algorithms: ['ES256'] enforced — prevents algorithm confusion attacks (still true per branch after decision 0002: the Supabase branch pins ES256 and the WorkOS branch pins RS256; the unverified decodeJwt is used only to pick a branch, and each branch re-checks `iss` strictly)
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
  - [03-01, SUPERSEDED 2026-11-17]: Recorded at the time as "Mux free plan blocks live RTMP ingest — Task 4 verification deferred pending Mux Growth plan upgrade (nonprofit discount request submitted)".  That diagnosis was wrong: the pipeline was verified end to end on the existing plan.  Task 4 had been deferred for seven months on a blocker that did not exist
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
  - [04-04]: SECURITY DEFINER RPC is correct write path into listening schema — PostgREST does not expose non-public schemas; pool.query bypasses RLS
  - [04-04]: original_text set only on first correction via COALESCE(original_text, text) — preserves Deepgram-generated text through repeated human edits
  - [04-04]: Word-level confidence filtering removed from deepgram-connection.ts — full alt.transcript string used for final entries; filtering caused silent truncation
  - [04-04]: Consecutive same-speaker entries merged in TranscriptPanel display layer — DB rows kept intact for auditability via original_text
  - [05-01]: DROP POLICY must precede DROP COLUMN when policy references that column — Postgres error 2BP01 enforces this ordering; migration repaired and re-applied
  - [05-01]: No next.config.ts change for @react-pdf/renderer — already on Next.js serverExternalPackages allowlist; manual addition would be redundant
  - [05-02]: requireConnectedTier(bearer) + mapTierError(err) is the standard pattern for Connected-tier gates; DELETE has no tier check (user can always remove own data)
  - [05-02]: 404 returned for both "not found" and "not yours" on PUT/DELETE — no ownership info leaked
  - [05-02]: Reorder uses ANY($3::uuid[]) ownership count check before opening transaction — fail fast before acquiring pool connection
  - [05-02]: checkedIds in notesStore is ephemeral client state (Record<string, boolean>); no is_checked field on NoteRow, never persisted to DB
  - [05-03]: renderToBuffer type cast (as unknown as ReactElement<DocumentProps>) bridges DebateNotesPdf component props to react-pdf's narrower DocumentProps constraint — runtime correct, TS-only workaround
  - [05-03]: alignNotesToTranscript sorts transcript copy once, binary-searches per note — preserves original indices via originalIndex field; inputs not mutated
  - [05-03]: Separate speaker-by-id query in export route resolves transcript_entries.speaker_id (UUID) to role/display_name; parallel fetch kept clean
  - [05-04]: Custom event 'notes:focus-input' from DesktopLayout's N handler → NotesPanel opens input — decouples without prop drilling through ObserverShell
  - [05-04]: useUserRole fetches tier inline (not via SessionProvider) to keep SessionProvider lightweight; brief null tier is acceptable
  - [05-04]: Export PDF via fetch → blob → object URL → anchor click (not plain <a href>) because route requires Authorization header
  - [05-04]: isAnonymous = !token && !loading (not just !token) — avoids flash of upgrade message during session load
  - [05-04]: NoteInput uses getState() (not reactive subscription) to read active segment at save time — avoids re-render churn
  - [2026-11-15 / PR #70]: Client identity resolves through `userIdFromToken` in lib/auth/user-id.ts (`external_id` first, then `sub`), not `decodeJwt(token).sub`.  useUserRole compared a raw WorkOS sub against `debate_speakers.user_id`, which is the internal UUID — a guaranteed miss that silently demoted every WorkOS-issued speaker and moderator to observer with no auth error anywhere.  Latent until now only because useUserRole's single consumer destructured `{ token, tier, loading }` and ignored `userRole`; 05-05 makes `userRole` load-bearing in five files.  Server side (`verifyToken` → `userId`) was already correct
  - [2026-11-15]: The browser Supabase client stays anon-key only (`persistSession: false`, nothing calls `realtime.setAuth()`), so `auth.uid()` is null in the browser and the `auth.uid()`-based RLS policies are dormant **by design** — recorded in a comment in lib/supabase/client.ts so the next reader does not "fix" it
  - [05-05]: Transcript entries arriving over the broadcast channel get a synthetic `${speakerId}-${spokenAt}` id (TranscriptPanel.tsx), but `source_transcript_entry_id` is a uuid FK and the POST schema validates `.uuid()`.  TranscriptEntry guards with a UUID regex and emits `data-transcript-entry-id` only for real ids; a selection on a not-yet-persisted line still becomes a note, just without an anchor.  The plan's instruction to tag every entry unconditionally would have returned 400 on live lines
  - [05-05]: promote and demote both roll back the optimistic store write when the PUT fails, rather than refetching.  Cheaper, but a failed write leaves no visible error — only a console line.  Revisit if speakers report notes "jumping back"
  - [05-05]: Rebuttal checkbox state is deliberately never persisted — "addressed" is a within-segment working state, not a fact about the debate, so a reload clears it
  - [2026-11-20 / PR #114]: A debate whose LiveKit room has been empty of speakers and moderator for two minutes is cancelled server-side by `lib/debate/abandon-watch.ts`, polling presence from the web process.  The participant count is an **allowlist** of `debate_speakers.livekit_identity` values, because the room also holds the transcription worker and the egress recorder — counting those meant no room was ever empty.  A new way for a human to join must write that column, or the watcher reads the room as empty and cancels a debate with people in it
  - [2026-11-22 / PR #75]: The bonus pool is charged inside `listening.end_segment`, not in the route, because it has to be atomic with the status transition — two things can end a segment (the moderator's tab and the expiry timer) and the charge must happen exactly once however they race.  `repeat_segment` refunds, because a discarded take should not cost the speaker anything.  `consume_bonus_time` and its TypeScript wrapper existed since Phase 2 and were never called by anything
  - [2026-11-22 / PR #76]: Segment expiry is server-side (`lib/debate/expiry-registry.ts`), one `setTimeout` per active segment in module scope, re-armed at boot from `instrumentation.ts` because a deploy drops them all.  In memory on a single instance, the same caveat as the abandon watcher.  The client hook that drove this is deleted
  - [2026-11-22 / PR #115]: Every path that stops a segment's clock charges through `listening.charge_segment_overrun` — `end_segment`, `start_segment` (which completes a still-active segment inline) and `start_prep_time`.  Prep taken after the buzzer was the worst leak: it snapshotted a remaining time of 0 and handed the pool back unspent, giving a second full bonus window.  `bonus_seconds_used` now accumulates rather than being assigned, so a take charged twice still refunds in full on repeat
  - [2026-11-22]: An overrun larger than the pool **empties the pool and charges no further** — `LEAST(overrun, pool)`.  The code review suggested charging nothing in that case, reading an overrun past the pool as not the speaker's to pay for.  Kept as-is by decision: the pool is the whole of the grace a speaker gets, so charging nothing beyond it would reward a longer overrun and put a cliff at the boundary, where 60s costs everything and 61s costs nothing.  A large overrun instead raises a `WARNING`, because what it really indicates is that nothing stopped the segment
  - [2026-11-22]: `SEGMENT_EXPIRY` gates the expiry timers the way `ABANDON_WATCH` gates the watcher (`1` on anywhere, `0` off in production, unset = production only), and the gate matters more here: the watcher fails safe without LiveKit credentials, while expiry needs nothing but the database — which a local checkout against the shared instance already has

### Pending Todos

- **Run 05-05 Task 3** (the two-browser live verification) and write `05-05-SUMMARY.md` once it passes.  Fold in the open check on issue #69 (PR #58's bonus-time render side effect) and confirmation that a WorkOS-issued speaker now resolves to `speaker` after PR #70 — one live sitting, not three.  Worth adding to the same sitting now that they are live: a segment left to expire on its own, and a bonus pool that should not refill between segments.
- **Add the `/moderator/*` middleware gate.**  `middleware.ts` matches `/join/:path*` only; the moderator UI gate is client-side.  Every API route behind it is protected server-side, so this is not a data exposure — but it has carried an "add before production" note since 02-03.
- **Issue #100** — `useUserRole` takes whichever `debate_speakers` row comes back first rather than the highest role.
- **Dependabot alert 52** (minimatch, medium) — needs a lockfile generated on Linux; see the CI note in CLAUDE.md.
- **Open question from 03-01**, not blocking: `latency_mode` `reduced` vs `low` on the Mux live stream.

### Blockers/Concerns

- [Pre-Phase 4]: Deepgram vs AssemblyAI transcription provider decision deferred; A/B test on real debate audio recommended before Phase 4 commit.
- [01-01]: 116 stub migration files were created to align local Supabase history with existing remote EV platform migrations — these stubs will appear in future migration lists.  This is expected; the listening migrations are 20260420000000 and 20260420000001.
- [RESOLVED - 02-02]: Moderator role question resolved — mintToken uses role='moderator' for roomAdmin grant; listening_host/listening_moderator slugs are the role identifiers.
- [RESOLVED - 02-02]: LD segment schedule definitive — 7 segments, 1920 total speaking seconds (32 min), LD_SEGMENTS in lib/debate/segments.ts is canonical.
- [02-03 follow-up, still open]: /moderator/* Next.js middleware not yet added — `middleware.ts:27` matches `/join/:path*` only, so the moderator UI gate is client-side.  Every API route it fronts is protected server-side, so this is a UI gate rather than a data exposure.  Add before production launch.
- [RESOLVED - 2026-11-17]: Live pipeline verification (03-01 Task 4) passed — LiveKit egress → RTMP → Mux → HLS, Mux reported `active` and the playback manifest served four renditions up to 720p.  **The free plan was never the blocker**, contrary to this entry's earlier claim and the April 2026 nonprofit-discount request it was waiting on.  Still open as a question, not a blocker: `reduced` vs `low` for `latency_mode`.
- [05-05 outstanding]: Phase 5 cannot be marked complete until 05-05 Task 3 passes.  **Nothing blocks it.**  It needs a speaker, an observer and a moderator across two browsers: promote/demote, drag order surviving a reload, checkboxes clearing on reload, keyboard drag a11y, the selection popup writing a real `source_transcript_entry_id`, the popup absent for observers and moderators, Export PDF unbroken, and a clean console.  The video tile will now show real video rather than "Stream unavailable.", which is a change from what this entry assumed, but the page renders either way.
- [#69 open]: The two-browser live check of PR #58 (bonus-time render side effect) was never run — PR #58 merged before manual verification.  Assigned to chrisandrewsedu.
- [2026-11-15 decision]: **Phase 6 (Voting and Badges) is deferred, not planned.**  Badges do not exist yet in ev-accounts, and the badge check is the premise of the vote gate rather than a detail of it — voting that ships without it contradicts its own purpose.  Geographic restriction is wanted eventually but has no column on `debates` and nothing to set.  Badges are the *only* prerequisite — the vote flows do not need the Mux pipeline, because the observer page degrades to "Stream unavailable." and keeps its timeline, transcript and notes panels working.  Scope is unchanged in ROADMAP.md; revisit when badges ship in ev-accounts.

## Session Continuity

Last session: 2026-11-22
Stopped at: #75, #76 and #115 merged, deployed and verified live (7365bf2, clean boot — abandon watch started, no segment timers to re-arm because nothing was running).  ev-infra#12 merged, registering `SEGMENT_EXPIRY` with no value; unset means production-only, which is the intended behaviour.
Resume file: None — Phase 6 remains deferred by decision (see Blockers).  Next work is issue #100 and the `/moderator/*` middleware gate; the live verification sitting and `05-05-SUMMARY.md` follow whenever a debate can be convened.
