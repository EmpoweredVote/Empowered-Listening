# Phase 03: Observer Streaming — Research (Plans 03-02 through 03-05)

**Researched:** 2026-04-22
**Domain:** HLS playback (hls.js), Supabase Realtime, React panel layouts, mobile-responsive CSS
**Confidence:** HIGH overall (stack verified against installed packages, official docs, and existing code)

---

## Summary

Plans 03-02 through 03-05 build the observer-facing side of Phase 3.  The pipeline is already live
after 03-01 (Mux produces an HLS URL).  These four plans are:

- **03-02** — HLS player page: hls.js + Safari fallback, pre-live state, "Live (delayed)" indicator
- **03-03** — Segment timeline overlay: Supabase Realtime reuse, visual segment progress
- **03-04** — Desktop multi-panel layout: resizable panels, keyboard shortcuts (Space/T/N/F)
- **03-05** — Mobile layout: portrait full-width + swipe tabs, landscape two-panel

**Key discoveries:**

1. `@mux/mux-player-react` exists and handles Safari natively, but it pulls in Mux's analytics stack
   and is an opinionated black box.  **Use raw hls.js** — it is one install, gives full control, and
   the existing 03-01 research assumed it.  The constraint "no new npm packages unless genuinely
   needed" is satisfied by a single `npm install hls.js`.

2. The observer page does NOT need its own Realtime subscription setup — `useDebateSync` (the hook
   from Phase 2) already does exactly what 03-03 needs.  Reuse it.  The Zustand store already holds
   all segments, their status, and their speaker_id.  The timeline overlay simply reads that store.

3. hls.js **does not retry on 404** by default.  When the debate has not started yet, the Mux m3u8
   returns 404.  The recommended pattern is: don't mount the player until `debate.status === 'live'`.
   The observer page polls `/api/debates/[debateId]/stream` at a slow interval (5 s) until status is
   `'live'`, then mounts the player.  Once mounted, hls.js handles all segment-level retries itself.

4. react-resizable-panels is at v4.10.0 and has **renamed exports**: `PanelGroup → Group`,
   `PanelResizeHandle → Separator`, `direction → orientation`.  shadcn/ui's resizable component is
   broken with v4 (open issues).  Use the library directly without the shadcn wrapper.

5. Tailwind v4 does **not** have built-in `landscape:` / `portrait:` modifiers (those were v3).
   Add them as `@custom-variant` in `globals.css`.

6. The "active speaker" for the timeline is on `debate_segments.speaker_id` (joined to
   `debate_speakers.display_name`).  There is no `current_segment_id` column on `debates` — the
   active segment is found by `status = 'active'` on `debate_segments`.

**Primary recommendation:** Observer page = server component that fetches stream info + debate
metadata, then renders two client components: `<HlsPlayer>` (03-02) and `<DebateSync>`-based
timeline overlay (03-03).  Desktop layout wraps these in react-resizable-panels Group (03-04).
Mobile layout uses CSS scroll-snap tabs (03-05) — no library needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hls.js` | 1.6.16 (stable) | HLS playback via MSE API | Industry standard; hls.js is what Mux and every CDN recommends for non-Safari |
| `react-resizable-panels` | 4.10.0 (latest) | Desktop resizable panels | Most-used panel-resize library in React; trusted by OpenAI, Adobe |
| `@supabase/supabase-js` | ^2.104.0 (already installed) | Realtime subscription | Already used in Phase 2 — reuse exact pattern from `useDebateSync` |
| `zustand` | ^4.5.7 (already installed) | Segment timeline state | Already holds all debate state — observer simply reads the same store |

### Already Installed — No New Installs Needed Except hls.js

| Library | Version | Already There |
|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.104.0 | Yes |
| `zustand` | ^4.5.7 | Yes |
| `next` | ^16.2.4 | Yes |
| `react` | ^19.2.5 | Yes |
| `tailwindcss` | ^4.2.2 | Yes |

### New Install Required

```bash
npm install hls.js
npm install react-resizable-panels
```

(`react-resizable-panels` is not currently in package.json.)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hls.js | `@mux/mux-player-react` | Mux player handles Safari + analytics automatically but pulls in ~200KB extra, opinionated UI, not customizable for "Live (delayed)" indicator placement |
| hls.js | Video.js + hls plugin | Video.js is heavier (the plugin ecosystem adds complexity); hls.js alone is the lighter choice |
| react-resizable-panels | Pure CSS flex/grid with no resize | No resize handle; spec says "resizable transcript panel" — library is needed |
| CSS scroll-snap tabs | `react-scroll-snap-tabs` library | CSS scroll-snap is sufficient, native, zero-JS — no library needed |

---

## Per-Plan Findings

---

### 03-02: HLS Observer Page

#### hls.js Integration Pattern for Next.js 15 App Router

The component must be a client component (`'use client'`).  Use `useRef` for the video element and
`useRef` for the hls instance (so hls.destroy() can be called on cleanup).

**Correct initialization order:**
1. `hls.attachMedia(videoRef.current)` — attach before loadSource
2. `hls.loadSource(url)` — load after attach
3. Listen to `Hls.Events.MANIFEST_PARSED` — stream is ready to play
4. Return cleanup: `hls.destroy()`

**Safari fallback** — check `Hls.isSupported()` first.  If false and
`video.canPlayType('application/vnd.apple.mpegurl')` is truthy, set `video.src = url` directly.
Safari uses its native HLS engine and needs no hls.js at all.

```typescript
// Source: LogRocket Next.js HLS article (verified pattern) + hls.js API.md
'use client';
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

export function HlsPlayer({ src, onReady }: { src: string; onReady?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        // Live stream tuning
        liveSyncDurationCount: 3,        // 3 segments behind live edge (stability)
        liveMaxLatencyDurationCount: 5,  // skip ahead if >5 segments behind
        lowLatencyMode: false,           // Mux 'reduced' latency uses standard HLS, not LL-HLS
        maxBufferLength: 30,
        enableWorker: true,
      });
      hls.attachMedia(video);
      hls.loadSource(src);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { onReady?.(); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad(); // attempt recovery
        }
      });
      return () => hls.destroy();

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src;
      video.addEventListener('loadedmetadata', () => onReady?.(), { once: true });
    }
  }, [src, onReady]);

  return <video ref={videoRef} controls playsInline className="w-full h-full" />;
}
```

#### Pre-Live Polling Strategy

hls.js does NOT retry on HTTP 404.  Mux returns 404 on the m3u8 until the RTMP connection is
established (i.e., until `debate.status === 'live'`).

**Recommended approach:** Do not mount the `<HlsPlayer>` until the API confirms `status === 'live'`.

```typescript
// Observer page polls /api/debates/[debateId]/stream every 5s while status !== 'live'
useEffect(() => {
  if (streamStatus === 'live') return; // stop polling
  const timer = setInterval(async () => {
    const res = await fetch(`/api/debates/${debateId}/stream`, {
      headers: { Authorization: `Bearer ${evToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setStreamData(data); // { mux_playback_id, status }
    }
  }, 5000);
  return () => clearInterval(timer);
}, [streamStatus, debateId, evToken]);
```

When `status === 'live'` and `mux_playback_id` is non-null, mount `<HlsPlayer>` with:
`https://stream.mux.com/${mux_playback_id}.m3u8`

Alternatively: subscribe to `listening.debates` via Realtime (the observer already needs it for
the segment timeline) and react to the `status` field changing to `'live'`.  This eliminates polling
entirely.  Recommended: use Realtime for status change, polling as fallback only.

#### Mux HLS URL Format

Confirmed: `https://stream.mux.com/{PLAYBACK_ID}.m3u8`

This is the correct format for both live streams and VOD assets.  No CORS issues — Mux's CDN
(`stream.mux.com`) serves with permissive CORS headers that allow browser HLS playback from any
domain.  No special proxy or server-side fetch is needed; the player can hit `stream.mux.com`
directly.

#### "Live (delayed)" Indicator

hls.js does not expose the exact delay in seconds via a simple event.  The indicator is
**always-on text** when the player is in live-stream mode — it does not need a dynamic number.

The spec says "honestly surface the 5-10 second HLS lag" — a static badge reading
"LIVE (delayed ~5-10s)" satisfies this.  No hls.js event or Mux metadata is needed.

Conditionally render the badge when `playerState === 'playing'` (i.e., after `MANIFEST_PARSED`
fires).  Hide it when `playerState === 'pre-live'` or `playerState === 'ended'`.

#### Live Stream Player Controls

For a live debate, remove the progress scrubber (there is nothing to scrub back to during live).
Standard `<video controls>` shows a timeline — this is acceptable for MVP.  If you want to hide the
timeline, use a custom controls overlay:

- **Show:** play/pause, volume, fullscreen
- **Hide or disable:** seek bar / progress (users cannot scrub live content meaningfully)
- **Show:** "Live (delayed)" badge, always visible while playing

For MVP, `<video controls playsInline>` is acceptable.  Custom controls can be Phase 4 polish.

#### Mux Latency Mode and hls.js Config

03-01 research recommended `latency_mode: 'reduced'` (12-20s delay).  This is standard HLS, not
LL-HLS.  Do NOT set `lowLatencyMode: true` in hls.js — that targets LL-HLS which Mux 'reduced'
mode does not produce.  Standard live HLS config is correct.

---

### 03-03: Segment Timeline Overlay

#### Data Already Available — Reuse useDebateSync

The `useDebateSync(debateId)` hook from Phase 2 already subscribes to:
- `listening.debate_segments` (all segments with status, speaker_id, allocated_seconds)
- `listening.debate_speakers` (display names)
- `listening.debates` (debate status)

The observer page calls `useDebateSync(debateId)` in its client shell, and the Zustand store
(`useDebateStore`) immediately has all timeline data.  No new Supabase subscription is needed.

**Important:** `useDebateSync` does an initial snapshot fetch (`/api/debates/[debateId]/snapshot`)
which requires auth (`Authorization: Bearer {ev_token}` header).  The observer page must pass the
ev_token in the same way the speaker join page does.

#### Data Shape for Timeline

From `debateStore.ts` and the schema:

```typescript
interface SegmentRow {
  id: string;
  sequence_order: number;         // 1-based ordering for display
  segment_type: LDSegmentType;    // e.g. 'affirmative_constructive'
  speaker_id: string | null;      // null for CX (both speakers)
  allocated_seconds: number;      // total time allotted
  actual_start: string | null;    // ISO timestamp
  actual_end: string | null;      // ISO timestamp
  status: 'upcoming' | 'active' | 'completed' | 'paused';
}

interface SpeakerRow {
  id: string;
  role: 'affirmative' | 'negative' | 'moderator';
  display_name: string;
}
```

**Active speaker:** `getActiveSegment()` returns the segment with `status === 'active'`.
`segment.speaker_id` looks up the speaker from `useDebateStore(s => s.speakers)`.
For CX segments (`speaker_id === null`), show "Cross-Examination" with no speaker name.

#### Visual States for Timeline

| Segment status | Visual treatment |
|----------------|-----------------|
| `upcoming` | Dim / muted — future segment |
| `active` | Highlighted, progress fill animating based on `end_time` |
| `completed` | Full fill, checkmark or strikethrough |
| `paused` | Highlighted but no animation (prep time in progress) |

For the active segment progress: use `computeRemainingMs()` from the store (already implemented)
to drive a CSS width percentage.  Update via `setInterval` at 1 Hz (no need for 100ms tick — this
is display only).

#### No Schema Changes Needed

All required data is already in the DB and already published to Realtime.  03-03 is purely a UI
component on top of existing state.

---

### 03-04: Desktop Multi-Panel Layout

#### react-resizable-panels v4 API

Current version: **4.10.0**.  Breaking change from v2/v3:

| v2/v3 export | v4 export |
|-------------|----------|
| `PanelGroup` | `Group` |
| `PanelResizeHandle` | `Separator` |
| `Panel` | `Panel` (unchanged) |
| `direction` prop | `orientation` prop |

**Do NOT use shadcn/ui's `<ResizablePanelGroup>`** — it still wraps v2 API and is broken with v4
(GitHub issues #9136 and #9197 are open as of 2026-04).  Use the library directly.

```typescript
import { Group, Panel, Separator } from 'react-resizable-panels';

<Group orientation="horizontal" className="h-screen">
  {/* Video panel — primary, takes remaining space */}
  <Panel defaultSize={60} minSize={40}>
    <HlsPlayer src={hlsUrl} />
  </Panel>

  <Separator className="w-1 cursor-col-resize bg-slate-700 hover:bg-slate-500" />

  {/* Transcript panel — Phase 4 placeholder */}
  <Panel defaultSize={25} minSize={15}>
    <TranscriptPanelPlaceholder />
  </Panel>

  <Separator className="w-1 cursor-col-resize bg-slate-700 hover:bg-slate-500" />

  {/* Notes/Emparks panel — Phase 5 placeholder */}
  <Panel defaultSize={15} minSize={10}>
    <NotesPanelPlaceholder />
  </Panel>
</Group>
```

The `Separator` component handles drag-to-resize and keyboard arrow key resizing out of the box.

#### Layout Persistence

`Group` supports `id` + `autoSaveId` for localStorage persistence of panel sizes.  Use
`autoSaveId="observer-desktop-layout"` so the panel sizes are remembered between sessions.

In v4, `autoSaveId` still works for localStorage (the `useDefaultLayout` hook is optional — the
prop approach is simpler).

#### SSR / Hydration

react-resizable-panels is a client component.  Wrap in `'use client'` and render conditionally
after mount to avoid SSR hydration mismatches on panel sizes.  Pattern:

```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <div className="h-screen" />; // skeleton placeholder
```

#### Keyboard Shortcuts (Space, T, N, F)

Standard `useEffect` + `document.addEventListener('keydown', ...)` pattern.  Must be in a
`'use client'` component.

```typescript
useEffect(() => {
  function handleKey(e: KeyboardEvent) {
    // Guard: don't fire when user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case ' ':
        e.preventDefault(); // prevent page scroll
        videoRef.current?.paused
          ? videoRef.current.play()
          : videoRef.current?.pause();
        break;
      case 't': case 'T':
        transcriptPanelRef.current?.focus();
        break;
      case 'n': case 'N':
        notesPanelRef.current?.focus();
        break;
      case 'f': case 'F':
        videoRef.current?.requestFullscreen();
        break;
    }
  }
  document.addEventListener('keydown', handleKey);
  return () => document.removeEventListener('keydown', handleKey);
}, []);
```

Keyboard shortcuts are only on the desktop layout — the mobile layout does not render this hook.

#### Placeholder Panel Design

Transcript (Phase 4) and Notes/Emparks (Phase 5) panels should render:
- A labeled container with the panel's future purpose
- A placeholder message: "Transcript — coming in Phase 4"
- Correct `role`, `tabIndex={0}` so keyboard focus works now

This ensures Phase 4/5 only need to replace the placeholder content, not restructure the layout.

---

### 03-05: Mobile Layout

#### Portrait vs Landscape Detection — Tailwind v4

Tailwind v4 does NOT have built-in `landscape:` / `portrait:` modifiers (they were v3 features).
Add them to `globals.css` as `@custom-variant`:

```css
/* In app/globals.css, after @import "tailwindcss" */
@custom-variant landscape {
  @media (orientation: landscape) { @slot; }
}
@custom-variant portrait {
  @media (orientation: portrait) { @slot; }
}
```

Then use: `portrait:flex-col`, `landscape:flex-row`, etc.

**Do NOT use JavaScript `window.orientation`** — it's deprecated.  The CSS media query is correct.

#### Portrait Layout

```
┌────────────────────────────────────┐
│         Video (full-width)         │  ← aspect-video, w-full
│                                    │
├────────────────────────────────────┤
│    Segment Timeline (sticky)       │  ← sticky, below video
├────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐    │  ← tab bar (3 tabs)
│  │ Info │  │Trans │  │Notes │    │
│  └──────┘  └──────┘  └──────┘    │
├────────────────────────────────────┤
│         Tab panel content          │  ← swipeable
│         (scroll-snap)              │
└────────────────────────────────────┘
```

#### Landscape Layout

```
┌──────────────────────┬─────────────┐
│   Video              │  Timeline   │
│   (full height       │  + Info     │
│    left ~60%)        │  (right     │
│                      │   ~40%)     │
└──────────────────────┴─────────────┘
```

The landscape layout is a simple two-panel CSS grid or flex row.  It does NOT need
react-resizable-panels (no resize handle on mobile).  Use Tailwind:

```tsx
<div className="landscape:flex landscape:h-screen portrait:block">
  <div className="landscape:w-3/5 portrait:w-full aspect-video landscape:aspect-auto">
    <HlsPlayer src={hlsUrl} />
  </div>
  <div className="landscape:w-2/5 landscape:overflow-y-auto portrait:hidden">
    <SegmentTimeline />
    {/* Info panel */}
  </div>
</div>
```

#### Swipe Tabs (Portrait) — CSS Scroll-Snap

No library needed.  Use CSS scroll-snap with a horizontal scroll container:

```tsx
{/* Tab bar at bottom */}
<div className="flex border-b portrait:flex landscape:hidden">
  <button onClick={() => scrollToTab(0)}>Info</button>
  <button onClick={() => scrollToTab(1)}>Transcript</button>
  <button onClick={() => scrollToTab(2)}>Notes</button>
</div>

{/* Scrollable tab panels */}
<div
  ref={scrollContainerRef}
  className="flex overflow-x-auto snap-x snap-mandatory portrait:flex landscape:hidden"
  style={{ scrollbarWidth: 'none' }}
>
  <div className="snap-start flex-shrink-0 w-full">Info panel content</div>
  <div className="snap-start flex-shrink-0 w-full">Transcript (Phase 4 placeholder)</div>
  <div className="snap-start flex-shrink-0 w-full">Notes (Phase 5 placeholder)</div>
</div>
```

`scrollToTab(index)` uses `scrollContainerRef.current.scrollTo({ left: index * width, behavior: 'smooth' })`.

Add `-webkit-overflow-scrolling: touch` via inline style for iOS momentum scrolling.

The tab bar buttons update their active state by listening to the `scroll` event on the container
and computing `Math.round(scrollLeft / containerWidth)` to determine the active index.

#### One Component or Two for Desktop vs Mobile

Recommended: **one observer page**, use `portrait:` / `landscape:` Tailwind variants plus a `hidden`
class for the desktop panel group:

```tsx
{/* Desktop: shown on md+ screens */}
<div className="hidden md:flex h-screen">
  <DesktopPanelLayout />
</div>

{/* Mobile: shown below md */}
<div className="md:hidden">
  <MobileLayout />
</div>
```

This avoids SSR hydration issues from JS-based screen-size detection.  The `md:` breakpoint
separates desktop (≥768px) from mobile (<768px).  On tablets in landscape, test which layout is
appropriate — md: should be the correct cutoff.

---

## Pitfalls

### Pitfall 1: Mounting hls.js Before Stream Is Live

**What goes wrong:** If `<HlsPlayer>` is mounted while `debate.status !== 'live'`, hls.js attempts
to load the m3u8, receives a 404, and treats it as a fatal non-recoverable error.  It will NOT
retry.  The player stays in a broken state even after the stream goes live.

**How to avoid:** Do not render `<HlsPlayer>` until `debate.status === 'live'` AND
`mux_playback_id` is non-null.  Show a "Waiting for debate to start..." placeholder until then.

**Warning signs:** Console shows `Hls.ErrorTypes.NETWORK_ERROR` with `details: 'manifestLoadError'`
and the player never recovers.

### Pitfall 2: react-resizable-panels v4 Export Names

**What goes wrong:** Importing `PanelGroup` or `PanelResizeHandle` from `react-resizable-panels`
with v4 installed → TypeScript error "Module has no exported member 'PanelGroup'".

**How to avoid:** Use `Group`, `Separator`, `Panel` and `orientation` prop.  Double-check with
`import type {}` to get IDE validation at author time.

### Pitfall 3: Tailwind v4 landscape: / portrait: Not Built-In

**What goes wrong:** Writing `landscape:hidden` or `portrait:hidden` in Tailwind v4 without
defining the custom variants → classes are silently ignored (no error, no styling).

**How to avoid:** Add `@custom-variant` blocks to `globals.css` before using these classes.
Test orientation switching in DevTools (rotate viewport).

### Pitfall 4: Supabase Realtime Schema Permission

**What goes wrong:** The observer's Supabase browser client connects without the EV JWT set.
RLS on `listening.debate_segments` blocks the Realtime payload — the channel subscribes but
receives no data changes.

**How to avoid:** The existing `useDebateSync` hook uses `getSupabaseBrowserClient()` which does
NOT call `setAuth()`.  This works for Phase 2 because speakers pass their JWT to the snapshot
API, not to Realtime directly.

Realtime RLS is evaluated using the JWT passed with the channel subscription.  The anon key is
used by default in the browser client.  The `listening.debate_segments` RLS policy must allow
`anon` role OR the authenticated user role.

Check `20260421000000_speaker_room_schema.sql` — GRANT SELECT on debate_segments is to `authenticated`,
and the RLS policy is `FOR SELECT TO authenticated`.  This means Realtime will work for
`authenticated` JWT holders, not anon.

The observer page must call `supabase.realtime.setAuth(evToken)` before subscribing — same as
any participant.  Examine whether `useDebateSync` already handles this.  If not, the observer
wrapper must call `setAuth` once before invoking `useDebateSync`.

**Warning signs:** Channel status shows SUBSCRIBED but no payload events arrive on segment changes.

### Pitfall 5: Hydration Mismatch in Panel Layout

**What goes wrong:** react-resizable-panels reads localStorage for persisted sizes on the client.
If rendered on the server, the default sizes differ from localStorage values → React hydration
mismatch warning and potential visual flicker.

**How to avoid:** Wrap the `<Group>` in a `mounted` state guard (render a CSS-identical skeleton
on first pass, swap to Group after useEffect fires).

### Pitfall 6: Scroll-Snap on iOS Requires No Scrollbar Override

**What goes wrong:** On iOS Safari, the horizontal scroll container with `snap-x` shows a thin
scrollbar that breaks the visual design.

**How to avoid:** Add `style={{ scrollbarWidth: 'none' }}` (Firefox) and a CSS rule
`.no-scrollbar::-webkit-scrollbar { display: none; }` (Chrome/Safari) to the scroll container.

### Pitfall 7: Space Key Default Behavior

**What goes wrong:** The Space key scrolls the page when the video element is not focused.
The keyboard shortcut handler fires but the page also scrolls.

**How to avoid:** Call `e.preventDefault()` in the Space key handler.  Already shown in the
code example above — do not forget it.

### Pitfall 8: useDebateSync Reuse — Reset on Unmount

**What goes wrong:** `useDebateSync` calls `useDebateStore.getState().reset()` on cleanup.
If the observer page mounts `useDebateSync` and then navigates away and back, the store resets
and re-fetches.  This is expected behavior but means the 03-03 timeline will briefly flash empty.

**How to avoid:** Show a loading skeleton while `debate === null` in the store.  Already handled
by the existing Phase 2 loading pattern.

---

## Code Examples

### Correct hls.js React Client Component

```typescript
// Source: hls.js API docs + LogRocket Next.js HLS article (verified)
'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

type PlayerState = 'loading' | 'playing' | 'error';

export function HlsPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        lowLatencyMode: false,
        maxBufferLength: 30,
        enableWorker: true,
      });
      hls.attachMedia(video);
      hls.loadSource(src);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setPlayerState('playing'));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad(); // attempt recovery
          } else {
            setPlayerState('error');
          }
        }
      });
      return () => hls.destroy();

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('loadedmetadata', () => setPlayerState('playing'), { once: true });
    } else {
      setPlayerState('error');
    }
  }, [src]);

  return (
    <div className="relative w-full aspect-video bg-black">
      <video ref={videoRef} controls playsInline className="w-full h-full" />
      {playerState === 'playing' && (
        <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
          LIVE · delayed ~5-10s
        </div>
      )}
      {playerState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          Connecting to stream...
        </div>
      )}
    </div>
  );
}
```

### Supabase Realtime — Observer Reuse Pattern

```typescript
// Reuse the EXACT hook from Phase 2 — no changes needed
import { useDebateSync } from '@/hooks/useDebateSync';
import { useDebateStore } from '@/store/debateStore';

// In observer client component:
useDebateSync(debateId);  // sets up Realtime + initial snapshot

// Read timeline data:
const segments = useDebateStore(s =>
  Object.values(s.segments).sort((a, b) => a.sequence_order - b.sequence_order)
);
const speakers = useDebateStore(s => s.speakers);
const activeSegment = useDebateStore(s => s.getActiveSegment());
```

### react-resizable-panels v4 Desktop Layout

```typescript
// Source: react-resizable-panels v4 CHANGELOG + npm search results
'use client';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useState, useEffect } from 'react';

export function DesktopObserverLayout({ hlsUrl }: { hlsUrl: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-screen bg-slate-950" />;

  return (
    <Group orientation="horizontal" autoSaveId="observer-desktop-layout" className="h-screen bg-slate-950">
      <Panel defaultSize={60} minSize={40}>
        {/* Video + timeline overlay */}
      </Panel>
      <Separator className="w-1 cursor-col-resize bg-slate-700 hover:bg-ev-muted-blue transition-colors" />
      <Panel defaultSize={25} minSize={15}>
        {/* Transcript — Phase 4 placeholder */}
        <div className="h-full flex items-center justify-center text-slate-500 text-sm">
          Transcript — available in a future update
        </div>
      </Panel>
      <Separator className="w-1 cursor-col-resize bg-slate-700 hover:bg-ev-muted-blue transition-colors" />
      <Panel defaultSize={15} minSize={10}>
        {/* Notes / Emparks — Phase 5 placeholder */}
        <div className="h-full flex items-center justify-center text-slate-500 text-sm">
          Notes — available in a future update
        </div>
      </Panel>
    </Group>
  );
}
```

### CSS Scroll-Snap Tabs (Mobile Portrait)

```typescript
// Pure CSS — no library
import { useRef, useState } from 'react';

const TABS = ['Info', 'Transcript', 'Notes'] as const;

export function MobileTabPanel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState(0);

  function scrollToTab(index: number) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.offsetWidth, behavior: 'smooth' });
    setActiveTab(index);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => scrollToTab(i)}
            className={`flex-1 py-2 text-sm font-medium ${
              activeTab === i ? 'text-ev-muted-blue border-b-2 border-ev-muted-blue' : 'text-slate-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Swipeable panels */}
      <div
        ref={scrollRef}
        className="flex flex-1 overflow-x-auto snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        onScroll={(e) => {
          const idx = Math.round(e.currentTarget.scrollLeft / e.currentTarget.offsetWidth);
          setActiveTab(idx);
        }}
      >
        {TABS.map((tab) => (
          <div key={tab} className="snap-start flex-shrink-0 w-full h-full overflow-y-auto p-4">
            {tab} panel — content placeholder
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Tailwind v4 Orientation Variants

```css
/* app/globals.css — add after @import "tailwindcss" */
@custom-variant landscape {
  @media (orientation: landscape) { @slot; }
}
@custom-variant portrait {
  @media (orientation: portrait) { @slot; }
}
```

---

## Architecture Patterns

### Recommended File Structure

```
app/
└── debates/
    └── [debateId]/
        ├── page.tsx                    # Server component: fetch stream info + debate metadata
        ├── ObserverShell.tsx           # Client component: auth + polling + state
        ├── HlsPlayer.tsx               # Client component: hls.js + Safari fallback
        ├── SegmentTimeline.tsx         # Client component: reads debateStore
        ├── DesktopLayout.tsx           # Client component: react-resizable-panels
        └── MobileLayout.tsx            # Client component: CSS scroll-snap tabs
```

### Server Component Strategy

The page (`page.tsx`) is a server component that:
1. Fetches initial `{ mux_playback_id, status }` from the DB (or calls the stream API with server-side auth)
2. Fetches debate metadata (title, topic, scheduled_start)
3. Passes both to `<ObserverShell>` as props

`ObserverShell` is the client boundary.  It:
- Reads `ev_token` from localStorage
- Polls `/api/debates/[debateId]/stream` until `status === 'live'`
- Calls `useDebateSync(debateId)` for Realtime
- Renders `<DesktopLayout>` or `<MobileLayout>` based on viewport

### State Flow

```
Server: DB → page.tsx (initial status, playback_id)
                ↓
Client: ObserverShell
  ├── Polls stream API (until live)
  ├── useDebateSync → Supabase Realtime → debateStore
  │
  ├── DesktopLayout (md:flex)
  │   ├── HlsPlayer (stream.mux.com HLS)
  │   ├── SegmentTimeline (debateStore)
  │   ├── TranscriptPlaceholder
  │   └── NotesPlaceholder
  │
  └── MobileLayout (md:hidden)
      ├── HlsPlayer (full-width)
      ├── SegmentTimeline (sticky)
      └── SwipeTabs (Info / Transcript / Notes)
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Video.js + hls plugin | hls.js directly | Lighter bundle, simpler API |
| `PanelGroup` / `PanelResizeHandle` (react-resizable-panels v2) | `Group` / `Separator` / `orientation` (v4) | Breaking change — must use new names |
| Tailwind v3 `landscape:` built-in | Tailwind v4 `@custom-variant landscape` | Must add to globals.css manually |
| `window.orientation` | CSS `orientation: landscape` media query | `window.orientation` is deprecated |
| shadcn Resizable component | Direct react-resizable-panels v4 import | shadcn wrapper is broken with v4 |

---

## Open Questions

1. **useDebateSync setAuth gap**
   - What we know: `getSupabaseBrowserClient()` does not call `setAuth()`.  Realtime RLS requires
     an authenticated JWT for the `listening` schema.
   - What's unclear: Does the anon key satisfy the RLS policy as written in Phase 2 migrations?
     The policy is `USING (true)` for `debate_segments` — this grants anon access.  If so, no
     setAuth is needed.  The Phase 2 migration must be read to confirm.
   - Recommendation: Read `20260421000001_listening_rls_policies.sql` in the plan to confirm.
     If RLS is `USING (true)` for all roles, no changes needed.  If `authenticated` role only,
     the observer page must call `supabase.realtime.setAuth(evToken)` before `useDebateSync`.

2. **Snapshot API auth for observers**
   - What we know: `useDebateSync` POSTs to `/api/debates/[debateId]/snapshot` with the ev_token.
   - What's unclear: Does the snapshot API allow any authenticated user (observer) or only participants?
   - Recommendation: Planner should verify the snapshot API auth — if it's participant-only,
     a separate observer snapshot endpoint may be needed.

3. **Mux VOD after debate ends**
   - What we know: When `debate.status === 'completed'`, the Mux stream is closed.  Mux creates
     a VOD asset from the recording.
   - What's unclear: What does the observer player show after the debate ends?  The HLS URL becomes
     a VOD URL — the same URL `https://stream.mux.com/{playback_id}.m3u8` works for both live and
     VOD.  hls.js handles both modes.
   - Recommendation: Observer player continues to work post-debate showing the full recording.
     The "Live (delayed)" badge changes to nothing (or "Recorded").  This is a simple `status`
     check — no separate VOD player is needed.

4. **react-resizable-panels v4 `autoSaveId` persistence**
   - What we know: v4 CHANGELOG mentions `useDefaultLayout` hook replacing prop-based persistence.
   - What's unclear: Whether `autoSaveId` still works as a prop in v4 or has been removed.
   - Recommendation: Verify from the installed package's TypeScript types after `npm install
     react-resizable-panels`.  If `autoSaveId` is gone, use `useDefaultLayout` hook instead.

---

## Sources

### Primary (HIGH confidence)
- `/c/Empowered Listening/hooks/useDebateSync.ts` — existing Realtime pattern (read directly)
- `/c/Empowered Listening/store/debateStore.ts` — segment and speaker data shapes (read directly)
- `/c/Empowered Listening/lib/supabase/client.ts` — existing Supabase browser client (read directly)
- `/c/Empowered Listening/package.json` — confirmed installed packages and versions (read directly)
- `/c/Empowered Listening/supabase/migrations/` — schema for debate_segments columns (read directly)
- `/c/Empowered Listening/.planning/phases/03-observer-streaming/03-01-RESEARCH.md` — Mux HLS URL format confirmed
- `github.com/video-dev/hls.js/releases` — v1.6.16 current stable, fetched directly
- `tailwindcss.com/docs/responsive-design` — v4 orientation modifiers NOT built-in, confirmed

### Secondary (MEDIUM confidence)
- LogRocket Next.js HLS article (fetched) — React hls.js useEffect pattern
- `github.com/video-dev/hls.js/blob/master/docs/API.md` (fetched) — Hls.Events.MANIFEST_PARSED, Hls.Events.ERROR, hls.destroy() cleanup
- `github.com/video-dev/hls.js/issues/2068` (fetched) — 404 no-retry behavior confirmed
- Mux official docs `mux.com/docs/guides/start-live-streaming` (fetched) — HLS URL format
- Mux player docs (fetched) — Safari uses native HLS engine
- `supabase.com/docs/guides/realtime/postgres-changes` (fetched) — schema filter support
- `react-resizable-panels.vercel.app` (fetched) — v4 current version
- `github.com/bvaughn/react-resizable-panels` (fetched) — v4 export renames confirmed
- WebSearch results for react-resizable-panels v4 breaking changes — cross-confirmed

### Tertiary (LOW confidence)
- WebSearch: Tailwind v4 `@custom-variant` for landscape/portrait — single source, pattern consistent with v4 CSS-first docs

---

## Metadata

**Confidence breakdown:**
- hls.js integration pattern: HIGH — multiple verified sources, API docs fetched
- Safari fallback pattern: HIGH — industry-standard, confirmed in multiple sources
- Pre-live polling strategy: HIGH — hls.js 404 no-retry behavior confirmed from GitHub issues
- Mux HLS URL format: HIGH — confirmed in 03-01 research + Mux docs
- Supabase Realtime reuse: HIGH — read existing code directly
- Segment data shape: HIGH — read existing store and migration files directly
- react-resizable-panels v4 API: MEDIUM-HIGH — export names confirmed from multiple sources, but `autoSaveId` prop status in v4 is uncertain
- Tailwind v4 orientation variants: MEDIUM — `@custom-variant` approach is consistent with v4 docs but single source
- Mobile scroll-snap pattern: HIGH — native CSS, well-documented

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (stable libraries; re-verify react-resizable-panels if major version changes)
