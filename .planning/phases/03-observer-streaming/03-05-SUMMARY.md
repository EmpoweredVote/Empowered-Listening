---
phase: 03-observer-streaming
plan: "05"
subsystem: observer-streaming
tags: [mobile, observer, scroll-snap, tailwind-v4, ux-01, orientation]

# Dependency graph
requires:
  - phase: 03-02
    provides: HlsPlayer component (hls.js + Safari fallback), anonymous stream endpoint
  - phase: 03-03
    provides: useObserverDebateSync hook, SegmentTimeline component
  - phase: 03-04
    provides: ObserverShell with md:hidden placeholder block (03-05 marker)
provides:
  - MobileLayout (portrait stack: video + sticky timeline + swipe tabs; landscape two-panel)
  - MobileTabs (CSS scroll-snap swipeable tabs, thumb-reachable tab bar)
  - "@custom-variant portrait/landscape in globals.css (block-form syntax)"
affects:
  - "(terminal plan for Phase 3 observer UI)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@custom-variant block-form required in Tailwind v4.2.2 — short-form (@custom-variant NAME (@media CONDITION);) rejected by PostCSS"
    - "CSS scroll-snap for swipe tabs — snap-x snap-mandatory on container, snap-start on each panel"
    - "Tab bar order-2 / panels order-1 via CSS flexbox order for thumb-reachable bottom placement"
    - "Orientation detection via portrait:/landscape: CSS classes — no JS window.matchMedia or deprecated window.orientation"
    - "HlsPlayer is default export — import HlsPlayer from './HlsPlayer' (not named import)"

key-files:
  created:
    - "app/debates/[debateId]/MobileLayout.tsx"
    - "app/debates/[debateId]/MobileTabs.tsx"
  modified:
    - "app/globals.css"
    - "app/debates/[debateId]/ObserverShell.tsx"

key-decisions:
  - "Block-form @custom-variant used: short-form syntax rejected by Tailwind v4.2.2/PostCSS combination (CssSyntaxError: has no selector or body)"
  - "CSS portrait:/landscape: classes work after @custom-variant block-form declarations — no JS fallback needed"
  - "HlsPlayer imported as default (matching its export default declaration) in MobileLayout"

patterns-established:
  - "MobileTabs pattern: scroll container has scrollbarWidth:none + .no-scrollbar class for cross-browser scrollbar suppression"
  - "Portrait/landscape detection: pure CSS via @custom-variant, not JS — works during SSR hydration"

# Metrics
duration: 4min
completed: 2026-04-22
---

# Phase 3 Plan 05: Mobile Observer Layout Summary

**Portrait swipe-tab layout (video + sticky SegmentTimeline + MobileTabs) and landscape two-panel layout wired into ObserverShell — orientation detection via CSS @custom-variant portrait/landscape (block-form, no JS)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-22T22:21:02Z
- **Completed:** 2026-04-22T22:25:28Z
- **Tasks:** 3/3 complete
- **Files modified:** 4

## Accomplishments

- globals.css: Added @custom-variant landscape and portrait using block-form syntax (short-form rejected by PostCSS); added .no-scrollbar::-webkit-scrollbar { display: none; } for iOS Safari
- MobileTabs: CSS scroll-snap swipeable tab component — snap-x/snap-mandatory container, snap-start panels, tab bar via flexbox order-2, panels order-1 (thumb-reachable bottom placement); active index tracks both tap and swipe; role=tab + aria-selected + aria-controls accessibility; min-h-[44px] iOS touch targets
- MobileLayout: portrait branch (aspect-video HlsPlayer + sticky SegmentTimeline + MobileTabs); landscape branch (two-panel: w-3/5 video | w-2/5 info+timeline); orientation detection via portrait:/landscape: CSS classes
- ObserverShell: replaced md:hidden placeholder block (03-05 marker) with MobileLayout component; removed boundary marker comment

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Tailwind v4 orientation @custom-variant blocks to globals.css** — `10ccdf5` (feat)
2. **Task 2: Create MobileTabs — CSS scroll-snap swipeable tabs** — `f388567` (feat)
3. **Task 3: Build MobileLayout and wire it into ObserverShell** — `33fdaa1` (feat)

## Files Created/Modified

- `app/globals.css` — @custom-variant landscape/portrait (block-form); .no-scrollbar::-webkit-scrollbar rule
- `app/debates/[debateId]/MobileTabs.tsx` — Swipeable tab component: scroll-snap container, tab bar, onScroll active index sync
- `app/debates/[debateId]/MobileLayout.tsx` — Portrait and landscape layout branches; imports HlsPlayer (default), SegmentTimeline (named), MobileTabs (named)
- `app/debates/[debateId]/ObserverShell.tsx` — MobileLayout import added; md:hidden block replaced; 03-05 marker comment removed

## Decisions Made

1. **@custom-variant block-form required:** The short-form syntax `@custom-variant landscape (@media (orientation: landscape));` was tried first and produced `CssSyntaxError: has no selector or body` from PostCSS. The block-form `@custom-variant landscape { @media (orientation: landscape) { @slot; } }` compiled successfully. This Tailwind v4.2.2 + PostCSS combination requires block-form.

2. **CSS portrait:/landscape: classes worked after block-form declarations:** No JS fallback (useState + window.matchMedia) was needed. The portrait:flex, portrait:flex-col, landscape:hidden, landscape:flex, portrait:hidden classes all compiled and will apply correctly via CSS media queries. This means orientation changes are handled entirely by the browser's CSS engine — no re-render needed.

3. **HlsPlayer default import:** HlsPlayer was declared as `export default function HlsPlayer` in 03-02. The plan's MobileLayout snippet used `import { HlsPlayer } from './HlsPlayer'` (named import). This was corrected to `import HlsPlayer from './HlsPlayer'` to match the actual export. DesktopLayout (03-04) confirmed this pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @custom-variant short-form syntax rejected**

- **Found during:** Task 1
- **Issue:** The plan showed short-form `@custom-variant landscape (@media (orientation: landscape));` syntax. PostCSS/Tailwind v4.2.2 rejected it with CssSyntaxError.
- **Fix:** Used block-form as the plan's fallback specified.
- **Files modified:** `app/globals.css`
- **Commit:** `10ccdf5`

**2. [Rule 1 - Bug] HlsPlayer named import would fail**

- **Found during:** Task 3
- **Issue:** Plan's MobileLayout snippet used `import { HlsPlayer }` (named import) but HlsPlayer uses `export default`. This would cause a runtime error (undefined component).
- **Fix:** Changed to `import HlsPlayer from './HlsPlayer'` matching DesktopLayout's established pattern.
- **Files modified:** `app/debates/[debateId]/MobileLayout.tsx`
- **Commit:** `33fdaa1`

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None.

## Next Phase Readiness

- **Phase 3 is functionally complete** for anonymous observers on any modern device (pending 03-01 Task 4 — Mux Growth plan for live RTMP ingest)
- **Phase 4 (transcript):** Replace placeholder divs in MobileLayout tabs (id: 'transcript') and DesktopLayout transcript panel with real transcription content
- **Phase 5 (notes):** Replace placeholder divs in MobileLayout tabs (id: 'notes') and DesktopLayout notes panel with real notes content
- No schema changes needed for Phase 4 transcript placeholders

---
*Phase: 03-observer-streaming*
*Completed: 2026-04-22*
