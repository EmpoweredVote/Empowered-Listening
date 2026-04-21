---
plan: 02-05
phase: 02-speaker-room
status: complete
---

# 02-05 Summary: Client State Layer

## What Was Built

- **`lib/supabase/client.ts`** — Browser-only Supabase client factory (`getSupabaseBrowserClient`).  `persistSession: false`, `autoRefreshToken: false`, `eventsPerSecond: 10`.  Cached singleton.
- **`store/debateStore.ts`** — Zustand store (`useDebateStore`) holding typed `DebateRow`, `DebateSegmentRow` (including `paused_remaining_seconds`), and `DebateSpeakerRow` state.  Actions: `setInitialSnapshot`, `applySegmentUpdate`, `applySpeakerUpdate`, `applyDebateUpdate`, `setSnapshotError`, `reset`.  Selectors: `computeRemainingMs`, `computePrepRemainingMs`, `getActiveSegment`, `getSegmentBySequenceOrder`.
- **`hooks/useDebateSync.ts`** — Fetches initial snapshot via `/api/debates/[debateId]/snapshot` (Bearer `ev_token`), then subscribes to `postgres_changes` on `listening.debate_segments`, `listening.debate_speakers`, and `listening.debates`.  Snapshot errors surface via `useDebateStore.setSnapshotError` (not silently swallowed).  Unsubscribes and resets store on unmount.
- **`hooks/useMicAutoPublish.ts`** — Listens for `participantPermissionsChanged` on the local participant; calls `setMicrophoneEnabled(true)` when `canPublish` transitions to true.  LiveKit handles revocation automatically.
- **`app/api/debates/[debateId]/snapshot/route.ts`** — GET returning `{ debate, segments (with paused_remaining_seconds), speakers }` for any authenticated user.  Uses `pool.query` (service-role, bypasses PostgREST).
- **`components/debate/DebateRoom.tsx`** — Updated to accept `debateId` prop, mount `useDebateSync(debateId)` at component level, and render `InnerRoom` (which calls `useMicAutoPublish`) inside `LiveKitRoom`.
- **`app/join/speaker/[debateId]/SpeakerJoinClient.tsx`** — Added `debateId` prop pass-through to `<DebateRoom>`.
- **`app/join/moderator/[debateId]/ModeratorJoinClient.tsx`** — Added `debateId` prop pass-through to `<DebateRoom>`.

## Commit History

- `c9ca146` feat(02-05): add Supabase browser client and Zustand debate store
- `a4041bd` feat(02-05): add useDebateSync, useMicAutoPublish, and snapshot API
- `31a4fe2` feat(02-05): mount useDebateSync and useMicAutoPublish in DebateRoom

## Deviations

None.  Plan followed exactly.

## Notes

- Supabase Realtime prereqs (GRANT SELECT, REPLICA IDENTITY FULL, ALTER PUBLICATION) were applied in plan 02-01 migration.  All three listening tables are publication-ready.
- `computeRemainingMs()` and `computePrepRemainingMs()` branch on `active.status === 'active'` vs `'paused'` respectively — prep-time snapshots faithfully restore via `end_prep_time` RPC (plan 02-01).
- `useMicAutoPublish` also runs the handler once at mount (`handler()` after registering) to handle the case where permissions are already set when the component mounts.
- `useDebateSync` calls `reset()` on unmount so stale state does not bleed into a remount.
