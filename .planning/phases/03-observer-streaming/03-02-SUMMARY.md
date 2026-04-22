---
phase: 03-observer-streaming
plan: "02"
subsystem: observer-streaming
tags: [hls, mux, observer, anon, safari-fallback, hls.js, video]

# Dependency graph
requires:
  - phase: 03-01
    provides: Mux HLS URL format (https://stream.mux.com/<mux_playback_id>.m3u8), GET /api/debates/[debateId]/stream endpoint, mux_playback_id column on listening.debates
provides:
  - HlsPlayer client component with hls.js + Safari native HLS fallback
  - Anonymous-accessible GET /api/debates/[debateId]/stream (no JWT required)
  - LIVE badge overlay ("LIVE · delayed ~5-10s") shown during active playback
  - hls.js@1.6.16 installed as npm dependency
affects:
  - 03-04 (consumes HlsPlayer — desktop multi-panel layout wraps it)
  - 03-05 (consumes HlsPlayer — mobile layout wraps it)

# Tech tracking
tech-stack:
  added:
    - "hls.js@1.6.16"
  patterns:
    - "Client-only component with 'use client' + direct hls.js import (no dynamic import needed — component is already client-only)"
    - "attachMedia before loadSource ordering per hls.js docs"
    - "PlayerState machine: loading → playing | error"
    - "Service-role pool routes enforce status gate explicitly when bypassing RLS"

key-files:
  created:
    - "app/debates/[debateId]/HlsPlayer.tsx"
  modified:
    - "app/api/debates/[debateId]/stream/route.ts"
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "Stream endpoint made anonymous — verifyToken block removed entirely; RLS and explicit SQL gate enforce status IN ('live', 'completed')"
  - "Service-role pool bypasses RLS, so status gate added inline to SQL query (not relying on RLS alone)"
  - "No-store Cache-Control on stream endpoint — polling clients always hit DB for current status"
  - "lowLatencyMode: false in hls.js config — Mux 'reduced' latency is standard HLS not LL-HLS"
  - "Direct hls.js import (not dynamic) — 'use client' directive makes the component client-only already"
  - "404 returns 'Debate not available' regardless of whether debate exists — prevents info leak about scheduled/cancelled debates"

patterns-established:
  - "HlsPlayer parent contract: mount only when src is available (status === 'live' AND mux_playback_id non-null) — documented in JSDoc"
  - "PlayerState machine pattern: 'loading' → 'playing' on MANIFEST_PARSED; 'error' on non-recoverable fatal"
  - "Safari fallback: canPlayType('application/vnd.apple.mpegurl') check; assign video.src directly; loadedmetadata fires once"

# Metrics
duration: 3min
completed: 2026-04-22
---

# Phase 3 Plan 02: HLS Observer Player Summary

**hls.js player with Safari native fallback, LIVE badge overlay, and anonymous stream endpoint — OBS-02 and OBS-04 primitives ready**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-22T22:02:48Z
- **Completed:** 2026-04-22T22:06:00Z
- **Tasks:** 2/2 complete
- **Files modified:** 4

## Accomplishments

- hls.js@1.6.16 installed; stream route fully open to anonymous observers with explicit status gate
- HlsPlayer.tsx created: hls.js + Safari native HLS fallback, MANIFEST_PARSED → playing state, LIVE badge overlay, fatal error recovery, hls.destroy() cleanup
- Stream endpoint now returns 404 for scheduled/cancelled debates without leaking existence; Cache-Control: no-store for polling clients

## Task Commits

Each task was committed atomically:

1. **Task 1: Install hls.js and open stream endpoint to anonymous observers** - `e08a949` (feat)
2. **Task 2: Create HlsPlayer client component with Safari fallback and LIVE badge** - `8573090` (feat)

## Files Created/Modified

- `app/debates/[debateId]/HlsPlayer.tsx` — Client-only HLS player; hls.js for Chrome/Firefox/Edge, native HLS for Safari; PlayerState machine; LIVE badge; hls.destroy() cleanup
- `app/api/debates/[debateId]/stream/route.ts` — Removed verifyToken; added status IN ('live', 'completed') SQL gate; Cache-Control: no-store
- `package.json` — hls.js@1.6.16 added
- `package-lock.json` — lock file updated

## Decisions Made

- **Stream endpoint anonymous access:** verifyToken removed entirely. RLS already allows anon SELECT on live/completed debates; the service-role pool bypasses RLS so the same gate is enforced inline in SQL. This keeps the endpoint simple and correct.
- **SQL status gate vs. RLS-only:** The route uses `getPool()` (service role), which bypasses Supabase RLS entirely. Relying on RLS alone would have been incorrect. Adding `AND status IN ('live', 'completed')` to the query is the correct defense.
- **404 info leak prevention:** `'Debate not available'` returned for both "debate not found" and "debate found but wrong status" — no leaking of scheduled/cancelled debate existence.
- **No dynamic import for hls.js:** The file is marked `'use client'`, so hls.js is bundled into the client chunk only. Dynamic import would be unnecessary overhead.
- **lowLatencyMode: false:** Mux `latency_mode: 'reduced'` creates standard HLS manifests, not LL-HLS. Setting `lowLatencyMode: true` would cause hls.js to misinterpret the manifest.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Stale `next build` lock from prior build. Killed node.exe and retried; second build succeeded immediately.

## Next Phase Readiness

- `<HlsPlayer src={hlsUrl} />` is ready for consumption by 03-04 (desktop layout) and 03-05 (mobile layout)
- Parent must poll `/api/debates/[debateId]/stream` until `status === 'live'` and `mux_playback_id` is non-null, then construct `https://stream.mux.com/<mux_playback_id>.m3u8` and pass as `src`
- 03-03 (segment timeline overlay) can be built independently — it reads from Zustand store via useDebateSync

---
*Phase: 03-observer-streaming*
*Completed: 2026-04-22*
