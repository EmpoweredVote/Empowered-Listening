---
phase: 03-observer-streaming
verified: 2026-04-22T00:00:00Z
status: human_needed
score: 5/6 must-haves verified (1 deferred by known Mux plan constraint)
---

# Phase 3: Observer Streaming Verification Report

**Phase Goal:** Anonymous observers can watch the live debate via HLS with an honest delay indicator and a segment timeline overlay
**Verified:** 2026-04-22
**Status:** human_needed
**Re-verification:** No -- initial verification

## Must-Have Analysis

### 1. LiveKit Egress RTMP pipeline starts automatically when a debate goes live

**Status:** Human needed (code verified; live execution blocked by Mux free plan)

**Evidence:**

The pipeline code is fully implemented and wired.  `app/api/debates/[debateId]/segments/[segmentId]/route.ts` lines 55-90 contain the egress bootstrap block triggered on the first action=start POST:

1. `createMuxLiveStream()` (`lib/mux/client.ts`) calls `getMux().video.liveStreams.create(...)` with `latency_mode: reduced` and `playback_policies: public`.  The stream_key and playback_ids[0].id are written to the debates row.
2. `startDebateEgress(roomName, muxStreamKey)` (`lib/livekit/egress-service.ts`) calls `client.startRoomCompositeEgress` with `StreamProtocol.RTMP`, `layout: speaker`, and `EncodingOptionsPreset.H264_720P_30`.  It checks for existing active egress first to avoid double-starting.
3. The returned egressId is written to `debates.livekit_egress_id` and `mux_stream_key` is nulled out (credential not left in DB after egress starts).
4. On last-segment end (status === completed), `stopDebateEgress` and `completeMuxLiveStream` are called.
5. DB migration `20260421100000_add_mux_egress_columns.sql` adds `mux_stream_id`, `mux_stream_key`, `mux_playback_id`, and `livekit_egress_id` columns to `listening.debates`.

The blocking constraint: Mux free plan rejects RTMP ingest at the Mux API level.  This is a Mux account constraint, not a code deficiency.  End-to-end verification requires the Mux Growth plan or the pending nonprofit discount approval.

---

### 2. Observer can watch the HLS stream in any modern browser; Safari uses native HLS fallback

**Status:** Verified (code); human needed (Safari live test)

**Evidence:**

`app/debates/[debateId]/HlsPlayer.tsx` (113 lines) is a complete non-stub implementation:

- Line 38: `if (Hls.isSupported())` -- Chrome/Firefox/Edge path via hls.js MSE.  Configured with `liveSyncDurationCount: 3`, `liveMaxLatencyDurationCount: 5`, `lowLatencyMode: false`.
- Line 71: `else if (video.canPlayType(...))` -- Safari native HLS path.  Sets `video.src = src` directly.  The `loadedmetadata` event transitions to `playing` state.
- Line 79: `else { setPlayerState(error) }` -- unsupported browser fallback.
- Fatal NETWORK_ERROR triggers `hls.startLoad()` recovery attempt.  Other fatal errors set error state.
- hls.js v1.6.16 installed and confirmed under `node_modules/hls.js/`.

HLS URL construction in `ObserverShell.tsx` lines 56-59: `https://stream.mux.com/[mux_playback_id].m3u8` -- only when status is `live` or `completed` AND `mux_playback_id` is non-null.  `HlsPlayer` is never mounted on a null `hlsUrl` (guarded by ternary in both layout components).

The `/api/debates/[debateId]/stream` anonymous GET route returns `{ mux_playback_id, status }` from the DB.  Field names match across producer (route.ts line 30) and consumer (ObserverShell.tsx lines 43-45).  `ObserverShell` polls this every 5 seconds while `status === scheduled`.

---

### 3. Segment timeline overlay shows current debate phase and active speaker at all times

**Status:** Verified

**Evidence:**

`app/debates/[debateId]/SegmentTimeline.tsx` (187 lines) is a complete implementation:

- Reads `useDebateStore` for live segment and speaker data (lines 34-37).
- Derives active segment by `status === active || status === paused` (line 47).
- Computes progress percentage from `end_time` and `allocated_seconds` with a 1-Hz `setInterval` tick (lines 41-44, 51-58).
- Renders 7 LD segment pills with color-coded status: active (blue ring), paused (amber ring), completed (dimmed), upcoming (slate).
- Shows current segment display name and active speaker name below the pills in an `aria-live` region (lines 165-175).
- Falls back to `LD_SEGMENTS` placeholder pills if store is empty -- does not render blank (lines 74-90).
- Paused segments show a static midpoint progress fill and append (Prep Time) label.

`SegmentTimeline` is rendered in three places:
- `DesktopLayout.tsx` line 85: in the page header (variant desktop)
- `MobileLayout.tsx` line 66: sticky bar in portrait layout (variant mobile)
- `MobileLayout.tsx` line 86: in the landscape sidebar (variant mobile)

Store is populated by `useObserverDebateSync`, called unconditionally in `ObserverShell.tsx` line 27.

---

### 4. Live (delayed) indicator is always visible during playback

**Status:** Verified

**Evidence:**

`HlsPlayer.tsx` lines 89-97: when `playerState === playing`, an absolutely-positioned badge renders top-left of the video:

- Styled: `bg-red-600 text-white text-xs font-bold px-2 py-1 rounded`
- Default `badgeLabel`: `LIVE - delayed ~5-10s` (line 95)
- For completed debates, callers pass `badgeLabel=Recorded` (DesktopLayout line 103, MobileLayout lines 17 and 77) -- correctly distinguishing live-with-delay from replay.
- Badge uses `role=status` and `aria-live=polite` for accessibility.
- Badge appears only after `MANIFEST_PARSED` (hls.js) or `loadedmetadata` (Safari) -- accurately reflects active playback, not premature.

---

### 5. Desktop multi-panel layout (video + resizable transcript + notes) with keyboard shortcuts

**Status:** Verified (code); human needed (interaction test)

**Evidence:**

`app/debates/[debateId]/DesktopLayout.tsx` (154 lines):

- Imports `Group`, `Panel`, `Separator`, `useDefaultLayout` from `react-resizable-panels` v4.10.0 (line 4).  All four symbols confirmed in the installed CJS bundle exports (`exports.Group`, `exports.Panel`, `exports.Separator`, `exports.useDefaultLayout`).
- Three panels: video (default 60%, min 35%), transcript (default 25%, min 15%), notes (default 15%, min 10%).
- `useDefaultLayout({ id: observer-desktop-layout-v1 })` wired to `Group` via `defaultLayout` and `onLayoutChanged` -- panel sizes persist via localStorage.
- `Separator` elements rendered with `cursor-col-resize` and `hover:bg-blue-600` styling.

Keyboard shortcuts (`keydown` listener, lines 31-72):
- `Space`: finds `<video>` in `videoContainerRef`, calls `play()` or `pause()`; `e.preventDefault()` prevents page scroll.
- `t`/`T`: calls `transcriptPanelRef.current?.focus()`.
- `n`/`N`: calls `notesPanelRef.current?.focus()`.
- `f`/`F`: calls `videoContainerRef.current?.requestFullscreen()`.
- Guard at lines 32-39 correctly skips shortcuts when focus is in an input or contenteditable.

The transcript and notes panels contain future-phase placeholder text -- intentional for Phase 3; the layout structure and keyboard shortcuts themselves are the deliverable.

---

### 6. Mobile portrait (full-width video + sticky timeline + swipe tabs); landscape (two-panel)

**Status:** Verified (code); human needed (device/orientation test)

**Evidence:**

`app/globals.css` lines 8-13 declare `@custom-variant landscape` and `@custom-variant portrait` for Tailwind v4.  Without these, `portrait:` and `landscape:` classes are silent no-ops in Tailwind v4 (which removed the built-in variants).  They are present and correctly target `@media (orientation: landscape/portrait)`.

`app/debates/[debateId]/MobileLayout.tsx` (95 lines):

Portrait layout (lines 63-69):
- Wrapper: `portrait:flex portrait:flex-col landscape:hidden h-full`
- Full-width video with `aspect-video` ratio
- `sticky top-0 z-10` SegmentTimeline bar directly below video
- `MobileTabs` fills remaining height with `flex-1 min-h-0`

Landscape layout (lines 72-92):
- Wrapper: `landscape:flex portrait:hidden flex-row h-full`
- Left column `w-3/5`: HlsPlayer
- Right column `w-2/5`: topic heading + SegmentTimeline + placeholder text

`app/debates/[debateId]/MobileTabs.tsx` (77 lines):
- `overflow-x-auto snap-x snap-mandatory` scroll container (line 57)
- `snap-start flex-shrink-0 w-full` per-tab panels (line 68)
- `onScroll` handler updates `activeIndex` from `scrollLeft / offsetWidth` (lines 52-56)
- `scrollToTab` uses `scrollTo({ behavior: smooth })` on tab button click
- Tab bar is `order-2` (bottom, thumb-reachable); scroll area is `order-1`
- `role=tablist`, `role=tab`, `aria-selected`, `role=tabpanel` semantics present
- `min-h-[44px]` on tab buttons for touch targets (line 38)
- `no-scrollbar` class hides scrollbar on iOS Safari (declared in globals.css line 16)

---

## Human Verification Checklist

### 1. RTMP Pipeline (must-have #1)

**Prerequisite:** Mux Growth plan or nonprofit discount applied.

**Test:** Create a debate, add speakers, click Start Segment 1.
**Check in DB:** `SELECT mux_stream_id, mux_playback_id, livekit_egress_id FROM listening.debates WHERE id = id` -- all three should be non-null within 3 seconds.
**Check in Mux dashboard:** Live stream appears with status active.
**Check in LiveKit dashboard:** Egress job listed for the debate room.
**Expected:** `https://stream.mux.com/[mux_playback_id].m3u8` becomes playable within 10 seconds.

### 2. Safari HLS Fallback (must-have #2)

**Test:** Open the debate URL in Safari on macOS or iOS while a debate is live.
**Expected:** Video plays.  DevTools confirm no hls.js MSE path was taken.  LIVE badge appears after stream loads.

### 3. Panel Resizing (must-have #5)

**Test:** On desktop (md+ viewport), drag the resize handle between video and transcript panels.
**Expected:** Widths change smoothly.  Refresh page -- panels restore to previously set sizes.

### 4. Keyboard Shortcuts (must-have #5)

**Test:** On desktop, click outside any input, then press Space, T, N, F in turn.
**Expected:** Space toggles video playback; T puts focus on transcript panel (blue ring visible); N puts focus on notes panel; F enters fullscreen.

### 5. Mobile Portrait Swipe Tabs (must-have #6)

**Test:** Open debate URL on a phone in portrait orientation.
**Expected:** Full-width video at top, sticky timeline below, three snap-scrollable tab panels (Info, Transcript, Notes).  Swipe and tap both work.  No scrollbar visible on iOS.

### 6. Mobile Landscape Layout (must-have #6)

**Test:** Rotate phone to landscape on the debate URL.
**Expected:** Portrait layout disappears; two-panel layout (60% video left, 40% sidebar right) appears with SegmentTimeline in sidebar.

### 7. Realtime Segment Timeline (must-have #3)

**Test:** Run a live debate and advance segments from the moderator panel.
**Expected:** Observer page pill row updates within 1-2 seconds.  Active speaker name below pills changes.  Progress fill advances at approximately 1 Hz.

### 8. Scheduled-to-Live Transition (must-have #2)

**Test:** Open a scheduled debate URL before the debate starts.  Then start the first segment from the moderator panel.
**Expected:** Within approximately 5 seconds (polling interval), the waiting placeholder is replaced by the HLS video player.

## Gaps Found

None.  All code paths are implemented and wired.  The only limitation is external: the Mux free plan blocks live RTMP ingest, preventing end-to-end verification of must-have #1 without a plan upgrade.

## Summary

Phase 3 code is fully implemented across all six must-haves.  The observer route (`app/debates/[debateId]/page.tsx`) fetches debate state server-side and passes it to `ObserverShell`, which wires `useObserverDebateSync` (anonymous Supabase Realtime + snapshot), polls the `/api/debates/[debateId]/stream` endpoint while scheduled, and renders either `DesktopLayout` or `MobileLayout` based on breakpoint.  `HlsPlayer` correctly handles hls.js for Chrome/Firefox/Edge and native HLS for Safari, shows a `LIVE - delayed ~5-10s` badge during active playback, and attempts recovery on transient network errors.  `SegmentTimeline` reads from `useDebateStore` and renders 7 Lincoln-Douglas segment pills with a 1-Hz progress fill and an active-speaker status row.  The desktop layout uses `react-resizable-panels` v4 with three panels and keyboard shortcuts (Space, T, N, F).  The mobile layout uses CSS `portrait:`/`landscape:` custom variants (declared in `globals.css`) and a scroll-snap tab component with proper ARIA semantics.  The RTMP pipeline in `app/api/debates/[debateId]/segments/[segmentId]/route.ts` calls `createMuxLiveStream` and `startDebateEgress` on first segment start, and tears down on debate completion.  The sole blocker to a full `passed` verdict is the Mux free plan restriction on RTMP ingest, which requires the Mux Growth plan or the pending nonprofit discount approval to verify end-to-end.

---

_Verified: 2026-04-22_
_Verifier: Claude (gsd-verifier)_
