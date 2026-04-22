---
phase: 03-observer-streaming
plan: "03"
subsystem: observer-streaming
tags: [observer, realtime, supabase, anon, timeline, zustand]
one-liner: "Anon observer-snapshot endpoint + useObserverDebateSync hook + SegmentTimeline overlay for unauthenticated viewers"

dependency-graph:
  requires:
    - "phase 02 (debateStore + LD segment types)"
    - "phase 02 RLS anon policies (20260421000002_fix_realtime_rls_anon.sql)"
  provides:
    - "useObserverDebateSync hook (anon Realtime + snapshot without ev_token)"
    - "observer-snapshot API route (anon-accessible, status IN live/completed gate)"
    - "SegmentTimeline component (reads debateStore, renders 7 LD pills, 1-Hz progress)"
  affects:
    - "03-04 (desktop shell invokes hook + renders SegmentTimeline)"
    - "03-05 (mobile shell invokes hook + renders SegmentTimeline)"

tech-stack:
  added: []
  patterns:
    - "Anon API route with application-layer RLS gate (status IN WHERE clause)"
    - "Observer twin hook pattern — parallel to useDebateSync without auth"
    - "Pure-reader Zustand subscriber component (SegmentTimeline reads, never writes)"
    - "1-Hz tick for progress fill via setInterval + forceTick pattern"

key-files:
  created:
    - "app/api/debates/[debateId]/observer-snapshot/route.ts"
    - "hooks/useObserverDebateSync.ts"
    - "app/debates/[debateId]/SegmentTimeline.tsx"
  modified: []

decisions:
  - id: "03-03-a"
    decision: "Observer snapshot endpoint gates on status IN SQL, not middleware"
    rationale: "Pool uses service role and bypasses RLS — gate must be replicated in WHERE clause"
  - id: "03-03-b"
    decision: "useObserverDebateSync does NOT call setAuth() on Realtime client"
    rationale: "RLS policies include anon role (confirmed in 20260421000002 migration) — anon key suffices"
  - id: "03-03-c"
    decision: "SegmentTimeline renders LD_SEGMENTS placeholder pills when store is empty"
    rationale: "Prevents flash of empty layout before first snapshot arrives"
  - id: "03-03-d"
    decision: "Channel name `observer-debate-${debateId}` distinct from participant `debate-${debateId}`"
    rationale: "Prevents Supabase channel collision when both hooks run in same browser session (edge case)"

metrics:
  duration: "4 minutes"
  completed: "2026-04-22"
  tasks-completed: 3
  tasks-total: 3
  deviations: 0
---

# Phase 3 Plan 03: Observer Segment Timeline Summary

## Objective

Deliver an anonymous-observer-safe Realtime sync hook and a segment timeline overlay component that renders the current Lincoln-Douglas segment and active speaker without requiring an ev_token.

## What Was Built

### 1. `/api/debates/[debateId]/observer-snapshot` (anon route)

Mirrors the participant `/snapshot` endpoint but strips the bearer/verifyToken guard.  Instead, the debate SELECT includes `AND status IN ('live', 'completed')` in SQL — this replicates the RLS policy gate for the service-role pool connection that bypasses Postgres RLS.  Scheduled and cancelled debates return 404.  Sets `Cache-Control: no-store`.

### 2. `hooks/useObserverDebateSync`

Twin of `useDebateSync` with two differences:
- Fetches `/api/debates/[debateId]/observer-snapshot` with no Authorization header.
- Does not call `supabase.realtime.setAuth()` — the anon RLS policies (migration `20260421000002`) include `TO authenticated, anon` for all three tables, so the browser client's anon key is sufficient.

Subscribes to three `postgres_changes` streams (`listening.debate_segments`, `listening.debate_speakers`, `listening.debates`) filtered by `debate_id`.  Channel name `observer-debate-${debateId}` is distinct from the participant channel to prevent collision.  Cleanup calls `reset()`.

### 3. `app/debates/[debateId]/SegmentTimeline.tsx`

Client component that reads `useDebateStore` (populated by either `useObserverDebateSync` or `useDebateSync` — the component is agnostic).

Features:
- Renders 7 LD segment pills sorted by `sequence_order`
- 4 visual states: upcoming (slate-800/muted), active (blue-600 + ring), paused (amber-600 + ring), completed (slate-700/opacity-70)
- 1-Hz `setInterval` tick drives progress fill on the active segment (`end_time` → elapsed percentage)
- Status row with current phase name + active speaker name, or "Cross-Examination" when `speaker_id` is null
- "Waiting for debate to begin..." when store is empty
- Desktop variant: standard row pills; mobile variant: `sticky top-0 z-10 bg-slate-950/95 backdrop-blur` with horizontal scroll
- Falls back to `LD_SEGMENTS` placeholder pills before the first snapshot arrives

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 03-03-a | Observer snapshot gates on SQL WHERE, not middleware | Service-role pool bypasses RLS — gate must be in WHERE clause |
| 03-03-b | No setAuth() in observer hook | Migration 20260421000002 confirmed anon role on all three tables |
| 03-03-c | LD_SEGMENTS placeholder pills when store empty | Prevents empty-layout flash before first snapshot |
| 03-03-d | Distinct channel name `observer-debate-*` | Prevents Supabase channel collision in edge case where both hooks run simultaneously |

## Deviations from Plan

None — plan executed exactly as written.

The plan noted the RLS anon question as an open concern; it was resolved by reading `20260421000002_fix_realtime_rls_anon.sql` which confirmed `TO authenticated, anon` on all three tables.  No `setAuth()` is required.

## Verification Results

- `npm run build` succeeds cleanly.
- observer-snapshot route: no `verifyToken`/`Authorization` references; `status IN` gate confirmed.
- useObserverDebateSync: no `ev_token`/`Authorization`/`localStorage` references; channel name `observer-debate-` confirmed; 3 `postgres_changes` subscriptions confirmed.
- SegmentTimeline: `'use client'` on line 1; 4 `useDebateStore` calls; `Cross-Examination` text present.

## Next Phase Readiness

- **03-04 (desktop shell):** Can call `useObserverDebateSync(debateId)` and render `<SegmentTimeline variant="desktop" />` — both are ready.
- **03-05 (mobile shell):** Can render `<SegmentTimeline variant="mobile" className="..." />` — sticky top bar behavior is implemented.
- No schema changes needed for 03-04 or 03-05.
