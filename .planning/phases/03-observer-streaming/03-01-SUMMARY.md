---
phase: 03-observer-streaming
plan: "01"
subsystem: infra
tags: [mux, livekit, egress, rtmp, hls, streaming, postgres, supabase]

# Dependency graph
requires:
  - phase: 02-speaker-room
    provides: LiveKit room with active participants, segment start/end API, debate DB schema
provides:
  - Mux live stream creation and completion via @mux/mux-node SDK singleton
  - LiveKit RoomCompositeEgress start/stop with RTMP-to-Mux pipeline
  - Idempotent egress bootstrap on first segment start (listEgress guard + livekit_egress_id null check)
  - Clean egress shutdown on debate completion (status=completed transition)
  - GET /api/debates/[debateId]/stream — observer HLS playback endpoint (mux_playback_id + status, no secrets)
  - env.ts fail-fast boot validation for MUX_TOKEN_ID + MUX_TOKEN_SECRET
affects:
  - 03-02 (observer player — consumes mux_playback_id from stream endpoint)
  - 03-03 (HLS playback URL depends on mux_playback_id column)
  - 03-04 (VOD asset finalization depends on completeMuxLiveStream being called)
  - 03-05 (recording pipeline depends on egress being established)

# Tech tracking
tech-stack:
  added:
    - "@mux/mux-node@14.0.1"
  patterns:
    - "server-only singleton pattern (getMux, getEgressClient — private, callers use typed helper exports)"
    - "Dynamic imports (await import()) in route handlers for lazy egress path"
    - "Belt-and-suspenders idempotency: DB column null check + listEgress({ active: true }) before startRoomCompositeEgress"
    - "mux_stream_key nulled immediately after egress starts — secret does not persist in DB"

key-files:
  created:
    - supabase/migrations/20260421100000_add_mux_egress_columns.sql
    - lib/mux/client.ts
    - lib/livekit/egress-service.ts
    - app/api/debates/[debateId]/stream/route.ts
  modified:
    - package.json
    - package-lock.json
    - lib/env.ts
    - app/api/debates/[debateId]/segments/[segmentId]/route.ts

key-decisions:
  - "MUX_TOKEN_ID + MUX_TOKEN_SECRET made required (z.string().min(1)) in env.ts — fail-fast at boot, not at debate start"
  - "Stream endpoint auth: inline verifyToken (same pattern as snapshot/route.ts) — no new auth helper needed"
  - "Dynamic imports used in segment route — lazy egress path avoids import cost on non-egress code paths"
  - "reconnect_window: 0 on Mux live stream — prevents phantom reconnection after debate ends"

patterns-established:
  - "lib/mux/client.ts: Mux SDK singleton pattern matching lib/livekit/room-service.ts"
  - "lib/livekit/egress-service.ts: EgressClient singleton with same pattern"
  - "Both modules import 'server-only' as first import — prevents accidental client-side use"

# Metrics
duration: 9min (Tasks 1-3 complete; Task 4 deferred — Mux free plan blocks RTMP ingest)
completed: 2026-04-22
---

# Phase 3 Plan 01: Mux + LiveKit Egress Pipeline Summary

**LiveKit RoomCompositeEgress wired to Mux RTMP ingest with idempotent start/stop, stream_key erasure, and HLS observer endpoint**

## Status

**COMPLETE WITH DEFERRED VERIFICATION — Tasks 1-3 complete and committed; Task 4 (live pipeline human-verify) deferred until Mux Growth plan is active.**

Mux free plan does not support RTMP ingest (requires Growth tier).  A nonprofit discount request has been submitted to Mux.  All code is merged and ready; verification will run once the plan is upgraded.

## Performance

- **Duration:** 9 min (Tasks 1-3)
- **Started:** 2026-04-22T14:10:45Z
- **Tasks completed:** 3 of 4 (Task 4 deferred)
- **Files modified:** 8

## Accomplishments

- @mux/mux-node installed; migration applied — 4 new columns on listening.debates (mux_stream_id, mux_stream_key, mux_playback_id, livekit_egress_id)
- lib/mux/client.ts + lib/livekit/egress-service.ts created: typed singletons with reconnect_window=0 and listEgress idempotency guard
- Segment route wired: action=start bootstraps Mux + egress on first call; mux_stream_key nulled after egress starts; action=end stops egress + completes Mux stream only on debate completion
- GET /api/debates/[debateId]/stream created: returns {mux_playback_id, status} with no secret fields, auth via verifyToken

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SDK, add DB columns, tighten env.ts** - `b591cee` (feat)
2. **Task 2: Create lib/mux/client.ts and lib/livekit/egress-service.ts** - `fd33464` (feat)
3. **Task 3: Wire segment route start/end + create observer stream API** - `f71c2b3` (feat)

## Files Created/Modified

- `supabase/migrations/20260421100000_add_mux_egress_columns.sql` — Adds mux_stream_id, mux_stream_key, mux_playback_id, livekit_egress_id to listening.debates
- `lib/mux/client.ts` — Mux SDK singleton; createMuxLiveStream (reconnect_window=0); completeMuxLiveStream
- `lib/livekit/egress-service.ts` — EgressClient singleton; startDebateEgress with listEgress idempotency guard; stopDebateEgress
- `lib/env.ts` — MUX_TOKEN_ID + MUX_TOKEN_SECRET now required (z.string().min(1))
- `app/api/debates/[debateId]/segments/[segmentId]/route.ts` — Egress bootstrap on action=start; egress stop on action=end when debate.status=completed
- `app/api/debates/[debateId]/stream/route.ts` — Observer HLS playback endpoint; returns mux_playback_id + status; no secrets
- `package.json` / `package-lock.json` — @mux/mux-node@14.0.1 added

## Decisions Made

- **MUX_TOKEN_ID/MUX_TOKEN_SECRET required in env.ts:** Fail-fast at boot prevents silent runtime failures when a debate starts with missing credentials.
- **Stream endpoint uses inline verifyToken:** The snapshot/route.ts pattern already exists for authenticated non-moderator endpoints; no new auth helper needed.
- **Dynamic imports in segment route:** `await import('@/lib/mux/client')` and `await import('@/lib/livekit/egress-service')` keep the hot path (repeat action, non-last-segment end) free of egress import cost.
- **reconnect_window: 0:** Per RESEARCH Pitfall 3 — prevents Mux from leaving stream in limbo state after debate ends.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Remote migration history out of sync — needed --include-all + migration repair**

- **Found during:** Task 1 (applying migration)
- **Issue:** `supabase db push` failed with "Remote migration versions not found in local migrations directory" for 3 remote-only migrations (20260422004321, 20260422032451, 20260422032958) and "Found local migration files to be inserted before last migration on remote"
- **Fix:** Ran `supabase migration repair --status reverted` for the 3 unknown remote versions, then `supabase db push --linked --include-all` to apply 3 pending local migrations plus the new mux_egress migration
- **Files modified:** None — migration repair only affects Supabase history table
- **Verification:** All 4 columns confirmed via `supabase db query`
- **Committed in:** b591cee (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Migration repair was a known risk per STATE.md note about remote migrations; resolved without scope change.

## Issues Encountered

- Docker not running on host — local Supabase CLI operations unavailable. Used `supabase db push --linked` to apply migration against remote project directly.

## Deferred: Task 4 — Live Pipeline Verification

**Why deferred:** Mux free plan does not support RTMP ingest.  Live stream creation requires the Growth plan (or nonprofit equivalent).

**What Task 4 would verify:**
- Moderator starts first segment; Mux dashboard shows stream in Active state
- `mux_playback_id` populated in `listening.debates`
- HLS URL `https://stream.mux.com/<mux_playback_id>.m3u8` resolves in a player
- Moderator ends debate; stream transitions to Idle/Completed in Mux dashboard

**Re-verify when:** Mux nonprofit Growth plan is approved and credentials are added to `.env.local`.

**Open question for 03-02:** Confirm whether `latency_mode: 'reduced'` is correct once live testing is possible.  Mux also offers `'low'` (LL-HLS) — the right choice depends on measured observer latency in a real debate session.

## Next Phase Readiness

- 03-02 (observer player UI) can be built immediately — it only needs `GET /api/debates/[debateId]/stream` which returns `{mux_playback_id, status}` and is already live
- `mux_playback_id` will be populated on first segment start once Mux plan is active
- HLS URL pattern: `https://stream.mux.com/<mux_playback_id>.m3u8`

---
*Phase: 03-observer-streaming*
*Completed: 2026-04-22 (Tasks 1-3; Task 4 deferred — Mux free plan blocks RTMP ingest)*
