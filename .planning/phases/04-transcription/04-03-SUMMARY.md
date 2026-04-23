---
phase: 04-transcription
plan: "03"
subsystem: ui
tags: [supabase-realtime, broadcast, transcript, zustand, react, postgres, hls, nextjs]

# Dependency graph
requires:
  - phase: 03-observer-streaming
    provides: ObserverShell, DesktopLayout, MobileLayout, useObserverDebateSync, useDebateStore
  - phase: 04-transcription/04-01
    provides: transcript_entries table in listening schema with spoken_at, debate_time_mmss, text columns
provides:
  - GET /api/debates/[debateId]/transcript — paginated transcript snapshot endpoint (anonymous)
  - useTranscriptSync hook — Supabase broadcast subscription for final/interim entries
  - TranscriptPanel component — live-updating panel with segment headers, auto-scroll, back-to-live
  - TranscriptEntry component — color-coded speaker label + body text rendering
  - original_text column on listening.transcript_entries (migration)
  - transcript_entries added to supabase_realtime publication with REPLICA IDENTITY FULL
affects:
  - 04-04 (moderator edit endpoint writes original_text; reads from same broadcast channel)
  - 05-notes (MobileLayout tabs pattern established here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Broadcast-ephemeral pattern: load DB snapshot first via GET, then subscribe to broadcast"
    - "useCallback stable refs to avoid re-subscription on every render in realtime hooks"
    - "Segment header dividers derived by matching spoken_at timestamps against actual_start timestamps"
    - "isFollowingLive ref + state pattern for auto-scroll with Back to live button"

key-files:
  created:
    - supabase/migrations/20260423000000_transcript_realtime.sql
    - app/api/debates/[debateId]/transcript/route.ts
    - hooks/useTranscriptSync.ts
    - components/transcript/TranscriptEntry.tsx
    - components/transcript/TranscriptPanel.tsx
  modified:
    - app/debates/[debateId]/ObserverShell.tsx
    - app/debates/[debateId]/DesktopLayout.tsx
    - app/debates/[debateId]/MobileLayout.tsx

key-decisions:
  - "TranscriptPanel uses allocated_seconds (not duration_seconds) — matches actual DebateSegmentRow field name"
  - "Segment display name derived via LD_SEGMENTS lookup (segment_type → displayName) — not stored in DB"
  - "GET transcript endpoint gates on debate existence only (not status) — transcript is public civic record regardless of debate status"
  - "MobileLayout and DesktopLayout build speakersMap/segmentsArray inline from useDebateStore — no prop drilling from ObserverShell"
  - "SEGMENT_DISPLAY_NAME lookup defined as module-level const in each layout — avoids re-creating on every render"

patterns-established:
  - "TranscriptPanel pattern: fetch snapshot on mount → subscribe to broadcast → render with segment dividers"
  - "InterimEntry map (speakerId → text) renders at bottom, replaced on onFinal for same speakerId"
  - "formatDuration(seconds) helper: Math.floor(s/60) + ':' + String(s%60).padStart(2,'0')"

# Metrics
duration: 4min
completed: 2026-04-23
---

# Phase 4 Plan 03: Observer Transcript Panel Summary

**Live transcript panel with Supabase broadcast subscription, DB snapshot load-on-mount, segment header dividers, auto-scroll + Back to live — replacing Phase 3 placeholder in observer desktop and mobile layouts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-23T14:05:59Z
- **Completed:** 2026-04-23T14:10:22Z
- **Tasks:** 2
- **Files modified:** 8 (2 created in migration/api, 6 created/modified for hook/components/layouts)

## Accomplishments

- DB migration adds `original_text` column, adds `listening.transcript_entries` to `supabase_realtime` publication with `REPLICA IDENTITY FULL`, and grants SELECT to both roles
- Anonymous GET `/api/debates/[debateId]/transcript` endpoint returns paginated entries from DB with optional `before`/`limit` cursor pagination
- `useTranscriptSync` hook subscribes to `transcript-{debateId}` broadcast channel; fires `onFinal` and `onInterim` callbacks with stable refs to prevent re-subscription
- `TranscriptEntry` renders color-coded speaker label (blue=Aff, amber=Neg, slate=Mod) + debate timestamp + body text
- `TranscriptPanel` loads DB snapshot on mount, subscribes to broadcast, groups entries by LD segment with "Segment Name — m:ss" header dividers, renders interim entries in italic, auto-scrolls to bottom with Back to live button when scrolled up
- `ObserverShell` now passes `debateId` to both `DesktopLayout` and `MobileLayout`
- `DesktopLayout` Phase 3 transcript placeholder replaced with wired `TranscriptPanel`
- `MobileLayout` transcript tab placeholder replaced with wired `TranscriptPanel`

## Task Commits

Each task was committed atomically:

1. **Task 1: DB migration + GET transcript endpoint** - `e8c2207` (feat)
2. **Task 2: useTranscriptSync hook + TranscriptPanel + TranscriptEntry + layout wiring** - `55c607a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/20260423000000_transcript_realtime.sql` — original_text column, supabase_realtime publication, REPLICA IDENTITY FULL, SELECT grants
- `app/api/debates/[debateId]/transcript/route.ts` — anonymous GET endpoint with cursor pagination; `export const runtime = 'nodejs'`
- `hooks/useTranscriptSync.ts` — Supabase broadcast hook; exports FinalEntry, InterimEntry types
- `components/transcript/TranscriptEntry.tsx` — single entry renderer with color-coded speaker label
- `components/transcript/TranscriptPanel.tsx` — full panel with snapshot load, broadcast subscription, segment headers, auto-scroll
- `app/debates/[debateId]/ObserverShell.tsx` — adds debateId prop to DesktopLayout and MobileLayout calls
- `app/debates/[debateId]/DesktopLayout.tsx` — adds debateId prop, imports TranscriptPanel, builds speakersMap + segmentsArray from store, replaces placeholder
- `app/debates/[debateId]/MobileLayout.tsx` — adds debateId prop, imports TranscriptPanel, builds speakersMap + segmentsArray from store, replaces transcript tab placeholder

## Decisions Made

- `TranscriptPanel` uses `allocated_seconds` (not `duration_seconds`) — matches actual `DebateSegmentRow` field; plan's prop interface listed `duration_seconds` but the real store field is `allocated_seconds`
- Segment display names derived via `LD_SEGMENTS` lookup at module level — `segment_type` is stored in DB, human-readable name comes from canonical `lib/debate/segments.ts`
- GET transcript endpoint gates on debate existence only, not status — transcript is a public civic record and should be accessible regardless of debate status (live, completed, etc.)
- `speakersMap` and `segmentsArray` built inline in each layout from `useDebateStore` — no prop drilling needed through `ObserverShell` since layouts already have store access
- `SEGMENT_DISPLAY_NAME` defined as module-level constant in each layout to avoid object recreation on every render

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TranscriptPanel props use `allocated_seconds` instead of `duration_seconds`**

- **Found during:** Task 2 (TranscriptPanel implementation)
- **Issue:** Plan's `DebateSegment` interface listed `duration_seconds: number` but the actual `DebateSegmentRow` in the store uses `allocated_seconds` (consistent with the DB column and `LDSegment` interface). Using `duration_seconds` would cause a type error and runtime breakage.
- **Fix:** Used `allocated_seconds` throughout `TranscriptPanel` props interface and `formatDuration` call
- **Files modified:** `components/transcript/TranscriptPanel.tsx`, `app/debates/[debateId]/DesktopLayout.tsx`, `app/debates/[debateId]/MobileLayout.tsx`
- **Verification:** `npx tsc --noEmit` clean
- **Committed in:** 55c607a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (field name mismatch, Rule 1 - Bug)
**Impact on plan:** Essential for type correctness; no scope creep.

## Issues Encountered

None — migration applied cleanly, TypeScript check clean after both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Transcript display pipeline complete: DB migration applied, GET endpoint live, broadcast hook ready, panel wired into observer layouts
- Ready for 04-04: moderator transcript edit endpoint (writes to `original_text`, updates `text`, broadcasts corrected final entry via same `transcript-{debateId}` channel)
- Ready for 04-05: Deepgram STT worker (produces `final` and `interim` broadcast events on the same channel this plan subscribes to)
- No blockers

---
*Phase: 04-transcription*
*Completed: 2026-04-23*
