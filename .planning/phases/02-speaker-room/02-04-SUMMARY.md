---
phase: "02"
plan: "04"
subsystem: speaker-room
tags: [livekit, video, join-flow, token-endpoint, react-components]
status: complete

dependency-graph:
  requires:
    - "02-01"  # debate_speakers schema and RLS policies
    - "02-02"  # mintToken, getPool, verifyToken primitives
  provides:
    - POST /api/debates/[debateId]/token — slot claim + LiveKit JWT mint
    - /join/speaker/[debateId] — full token-fetch + DebateRoom mount
    - /join/moderator/[debateId] — same with WaitingRoom panel
    - components/debate/DebateRoom — LiveKitRoom wrapper
    - components/debate/ParticipantGrid — 3-tile grid
    - components/debate/SpeakerTile — video + mic indicator per participant
    - components/debate/WaitingRoom — connection status per identity
  affects:
    - "02-05"  # mic permission controls use same DebateRoom context
    - "02-06"  # timer overlay mounts inside DebateRoom
    - "02-07"  # debate end/archive flow reads same speaker slot structure

tech-stack:
  added: []
  patterns:
    - "Slot claim via conditional UPDATE WHERE user_id IS NULL prevents race conditions"
    - "useTracks([Track.Source.Camera]).filter(t => t.participant.identity === expectedIdentity) for per-participant video"
    - "localStorage ev_token read in useEffect — server component passes speaker metadata, client fetches LiveKit token"
    - "DebateRoom accepts token+serverUrl as props — clean separation of fetch logic from room UI"

key-files:
  created:
    - app/api/debates/[debateId]/token/route.ts
    - app/join/speaker/[debateId]/SpeakerJoinClient.tsx
    - app/join/moderator/[debateId]/ModeratorJoinClient.tsx
    - components/debate/DebateRoom.tsx
    - components/debate/ParticipantGrid.tsx
    - components/debate/SpeakerTile.tsx
    - components/debate/WaitingRoom.tsx
  modified:
    - app/join/speaker/[debateId]/page.tsx
    - app/join/moderator/[debateId]/page.tsx

decisions:
  - id: "02-04-a"
    decision: "VideoTrack uses trackRef prop (TrackReference type from @livekit/components-core) — not a participant prop"
    rationale: "Actual VideoTrack API takes trackRef?: TrackReference where TrackReference = { participant, publication, source }; useTracks returns this type directly"
  - id: "02-04-b"
    decision: "useTracks([Track.Source.Camera]) returns room-wide track list; filter by identity for per-tile video"
    rationale: "No per-participant useTracks variant; the hook returns all camera tracks in the room, so filtering by participant.identity is required"
  - id: "02-04-c"
    decision: "@livekit/components-styles imported in DebateRoom.tsx (not globals.css) for encapsulation"
    rationale: "DebateRoom is the only consumer; co-locating the styles import keeps the concern local and avoids polluting global CSS"
  - id: "02-04-d"
    decision: "mintToken grep returns 2 (import + call) not 1 as plan stated — both are correct"
    rationale: "Plan verification check was written expecting only the function call but grep also matches the import line; file is correct"

metrics:
  tasks-completed: 3
  tasks-total: 3
  deviations: 0
  duration: "~5 minutes"
  completed: "2026-04-21"
---

# Phase 02 Plan 04: Join Flow and LiveKit Room Components Summary

**One-liner:** Token endpoint with atomic slot claim + four LiveKit React components wired to /join/speaker and /join/moderator pages.

## What Was Built

### Task 1 — POST /api/debates/[debateId]/token (commit: 07fe2f0)

The token endpoint is the gatekeeper for LiveKit room entry:

1. Verifies the `Authorization: Bearer` JWT via JWKS (ES256)
2. Validates `speakerId` is a UUID via Zod
3. Queries `listening.debate_speakers JOIN listening.debates` for role, current `user_id`, `livekit_identity`, and `livekit_room_name`
4. If slot is unclaimed (`user_id IS NULL`): runs a conditional UPDATE that only sets `user_id` if it's still NULL (prevents race conditions where two users claim simultaneously)
5. If slot is claimed by another user: returns 403
6. Mints a LiveKit JWT via `mintToken()` with role `speaker` or `moderator`
7. Returns `{ token, serverUrl, identity, role }`

### Task 2 — Debate Room Components (commit: b512c68)

Four `'use client'` components in `components/debate/`:

**SpeakerTile:** Renders one participant's video tile. Uses `useTracks([Track.Source.Camera])` filtered by `participant.identity` to get the correct `TrackReference`, passes it to `VideoTrack`. Shows camera-off state when no track exists and waiting state when participant hasn't connected. Name overlay and mic indicator (emerald/slate) overlaid absolutely.

**ParticipantGrid:** Accepts `DebateSpeakerInfo[]`, maps to `byRole` record, renders in `affirmative | moderator | negative` order as a 3-column grid.

**WaitingRoom:** Lists all speakers with Connected/Waiting status. Builds `connectedIdentities` Set from `useLocalParticipant().localParticipant.identity` and `useRemoteParticipants().map(p => p.identity)`.

**DebateRoom:** `LiveKitRoom` wrapper with `connect=true audio=true video=true`. Imports `@livekit/components-styles` for LiveKit default theme. Renders `RoomAudioRenderer` (enables audio playback), optional `WaitingRoom`, and `ParticipantGrid`.

### Task 3 — Join Pages (commit: 315dd8b)

**Server pages** (`page.tsx` for both speaker and moderator):
- Read `params.debateId` and `searchParams.s` (speakerId)
- Check `x-mobile-gate` header — render `DesktopGate` with full `joinUrl` including `?s=` param
- 404 if no `?s=` param
- Query all 3 debate_speakers for the debate; 404 if count != 3
- Pass speaker metadata to client component (no JWT work server-side)

**Client components** (`SpeakerJoinClient.tsx`, `ModeratorJoinClient.tsx`):
- `useEffect` reads `ev_token` from `localStorage`
- POST to `/api/debates/${debateId}/token` with Bearer token and `{ speakerId }`
- On success: transitions to `ready` state with `token` and `serverUrl`
- On error: shows inline error message
- `ready` state: mounts `DebateRoom` — speaker with `showWaitingRoom={false}`, moderator with `showWaitingRoom={true}`

## LiveKit API Findings

### What matched the plan

- `LiveKitRoom`, `RoomAudioRenderer`, `useRemoteParticipants`, `useLocalParticipant`, `VideoTrack`, `useTracks` — all exported from `@livekit/components-react` as expected
- `Track` and `Participant` types exported from `livekit-client`
- `@livekit/components-styles` installed and importable
- `useTracks([Track.Source.Camera])` returns `TrackReference[]` — correct for filtering and passing to `VideoTrack`

### Adaptations needed

- **VideoTrack prop:** The plan used `trackRef={videoRef}` which is correct — `VideoTrack` prop is `trackRef?: TrackReference`. No change needed.
- **TrackReference type:** `TrackReference = { participant: Participant; publication: TrackPublication; source: Track.Source }` — the `.participant.identity` filter pattern in the plan works exactly.
- **useLocalParticipant return shape:** Returns `{ localParticipant: LocalParticipant, isMicrophoneEnabled, ... }` — `localParticipant.isMicrophoneEnabled` is available directly on the `LocalParticipant` instance.

### Styles import

`@livekit/components-styles` imported directly in `DebateRoom.tsx` (`import '@livekit/components-styles'`). This works in Next.js because DebateRoom is a client component. No addition to `globals.css` needed.

## livekit_identity Format

`{debateId}:{role}:{speakerId}` — e.g., `abc123:aff:xyz789`

This is set when debate_speakers rows are created (Phase 02-01/02-03) and read directly from the DB column in the token endpoint and passed through to client components as `livekitIdentity`.

## Browser Permission Notes

When testing from the same machine with multiple tabs:
- Each tab will request camera/microphone permissions independently
- Audio echo is expected when multiple tabs are open simultaneously in the same room — production use will have participants on separate physical machines
- The `RoomAudioRenderer` component handles audio output automatically; no additional AudioContext wiring is needed

## Deviations from Plan

None — plan executed exactly as written.

## Success Criteria Check

- [x] POST /api/debates/[debateId]/token mints LiveKit JWT, claims unclaimed slots, rejects foreign claims with 403
- [x] /join/speaker and /join/moderator fetch tokens and mount DebateRoom
- [x] DebateRoom uses LiveKitRoom with audio=true video=true and RoomAudioRenderer
- [x] ParticipantGrid shows 3 equal SpeakerTiles
- [x] SpeakerTile shows name + mic indicator only (no role label)
- [x] WaitingRoom shows connection status per participant
- [x] tsc --noEmit passes (zero errors)
