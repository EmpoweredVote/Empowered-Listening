---
phase: 03-observer-streaming
plan: "04"
subsystem: observer-streaming
tags: [desktop, observer, panels, keyboard-shortcuts, ux-02, react-resizable-panels, hls]

# Dependency graph
requires:
  - phase: 03-02
    provides: HlsPlayer component (hls.js + Safari fallback), anonymous /api/debates/[debateId]/stream endpoint
  - phase: 03-03
    provides: useObserverDebateSync hook (anon Realtime + snapshot), SegmentTimeline component
provides:
  - /debates/[debateId] route (server component, pool.query, notFound on missing/wrong-status debate)
  - ObserverShell client component (wires useObserverDebateSync, polls stream endpoint, desktop/mobile split)
  - DesktopLayout client component (three resizable panels, keyboard shortcuts Space/T/N/F, timeline header)
affects:
  - 03-05 (replaces md:hidden branch of ObserverShell and adds MobileLayout)

# Tech tracking
tech-stack:
  added:
    - "react-resizable-panels@4.10.0"
  patterns:
    - "v4 exports: Group/Panel/Separator (NOT PanelGroup/PanelResizeHandle — v2 names)"
    - "v4 orientation prop (NOT direction prop — v2 name)"
    - "v4 persistence: useDefaultLayout({ id }) hook returns defaultLayout + onLayoutChanged (autoSaveId prop removed in v4)"
    - "SSR hydration guard pattern: mounted state gate before rendering Group to avoid localStorage size mismatch"
    - "Space key preventDefault guard before play/pause — prevents page scroll"

key-files:
  created:
    - "app/debates/[debateId]/page.tsx"
    - "app/debates/[debateId]/ObserverShell.tsx"
    - "app/debates/[debateId]/DesktopLayout.tsx"
  modified:
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "v4 autoSaveId is gone — useDefaultLayout({ id: 'observer-desktop-layout-v1' }) replaces it; returns defaultLayout and onLayoutChanged props for Group"
  - "videoContainerRef is a div ref; querySelector('video') used inside Space key handler to reach actual video element"
  - "Observers are anonymous — no ev_token read, no auth headers on stream polling"
  - "Desktop gate in middleware.ts is for speaker/moderator join paths only — /debates/[debateId] is not gated"
  - "Mobile fallback renders 03-05 placeholder with explicit 03-05 boundary marker comment"

patterns-established:
  - "react-resizable-panels v4 import: Group, Panel, Separator, useDefaultLayout from 'react-resizable-panels'"
  - "Panel size persistence via useDefaultLayout hook, not autoSaveId prop"

# Metrics
duration: 4min
completed: 2026-04-22
---

# Phase 3 Plan 04: Desktop Observer Layout Summary

**Three-panel resizable observer view at /debates/[debateId] using react-resizable-panels v4 (Group/Panel/Separator), with Space/T/N/F keyboard shortcuts and localStorage size persistence via useDefaultLayout**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-22T22:11:57Z
- **Completed:** 2026-04-22T22:15:57Z
- **Tasks:** 2/2 complete
- **Files modified:** 5

## Accomplishments

- react-resizable-panels@4.10.0 installed; confirmed v4 export names (Group, Panel, Separator, useDefaultLayout) before writing any code
- /debates/[debateId] server route created: pool.query debates table, notFound() for missing/wrong-status, renders ObserverShell
- ObserverShell wires useObserverDebateSync (anon Realtime), polls /api/debates/[debateId]/stream every 5s while scheduled, computes hlsUrl from status+mux_playback_id, desktop/mobile split with 03-05 boundary marker
- DesktopLayout: three resizable panels (60/25/15 default), segment timeline in header, keyboard shortcuts (Space/T/N/F), localStorage size persistence via useDefaultLayout hook, HLS null guard, Phase 4/5 placeholders

## Task Commits

Each task was committed atomically:

1. **Task 1: Install react-resizable-panels and scaffold observer route + shell** - `8dcef70` (feat)
2. **Task 2: Build DesktopLayout — three resizable panels, timeline overlay, keyboard shortcuts** - `6e95bdd` (feat)

## Files Created/Modified

- `app/debates/[debateId]/page.tsx` — Server component; pool.query SELECT id/status/mux_playback_id/topic; notFound() gate; renders ObserverShell
- `app/debates/[debateId]/ObserverShell.tsx` — Client shell; useObserverDebateSync; 5s stream polling while scheduled; hlsUrl computation; desktop/mobile split with 03-05 marker
- `app/debates/[debateId]/DesktopLayout.tsx` — Three-panel Group (orientation="horizontal"); useDefaultLayout for size persistence; mounted hydration guard; keydown handler (Space/T/N/F); SegmentTimeline in header; HLS null guard
- `package.json` — react-resizable-panels@4.10.0 added
- `package-lock.json` — lock file updated

## Decisions Made

- **v4 autoSaveId removed:** The research doc noted uncertainty about whether autoSaveId still works in v4. Confirmed via package inspection: autoSaveId prop does not exist in v4. The replacement is `useDefaultLayout({ id: 'observer-desktop-layout-v1' })` which returns `{ defaultLayout, onLayoutChanged }` props to pass to Group.
- **videoContainerRef is a div, not a video ref:** The plan wraps HlsPlayer in a container div. The Space key handler uses `videoContainerRef.current?.querySelector('video')` to reach the actual video element for play/pause.
- **Observers are fully anonymous:** No ev_token read anywhere in page.tsx, ObserverShell, or DesktopLayout. Stream polling uses no auth headers.
- **Mobile fallback placeholder:** The md:hidden block renders a "Open this page on a desktop browser" message. 03-05 will replace this entire block with MobileLayout.

## Deviations from Plan

### Auto-fixed Issues

None.

### API Clarification

The plan's Task 2 said `videoContainerRef.current?.requestFullscreen()` for the F key. This calls requestFullscreen on the div wrapper (not the video element directly), which is valid and fullscreens the entire panel container including any overlaid badge. This matches the plan's intent.

The plan's Task 2 said `toggle video.paused` with videoContainerRef. Since videoContainerRef is a div wrapping HlsPlayer, `querySelector('video')` retrieves the actual HTMLVideoElement. This is the correct approach.

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **03-05 (mobile layout):** Replace the `md:hidden` block in ObserverShell with a proper `<MobileLayout>` component. The 03-05 boundary marker comment is on line 68 of ObserverShell.tsx.
- **Phase 4 (transcript):** Replace the placeholder div inside the transcript Panel in DesktopLayout with actual transcript content.
- **Phase 5 (notes):** Replace the placeholder div inside the notes Panel in DesktopLayout with actual notes content.
- No schema changes needed for 03-05.

---
*Phase: 03-observer-streaming*
*Completed: 2026-04-22*
