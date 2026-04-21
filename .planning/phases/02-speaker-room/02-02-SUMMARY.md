---
phase: 02-speaker-room
plan: "02"
subsystem: infra
tags: [livekit, zustand, postgres, typescript, npm]

requires:
  - phase: 01-foundation
    provides: lib/env.ts, DATABASE_TRANSACTION_POOLER_URL, LiveKit credentials from 01-02
provides:
  - lib/db/pool.ts — pool.query singleton for listening schema writes
  - lib/livekit/tokens.ts — mintToken for speaker/moderator JWT generation
  - lib/livekit/room-service.ts — setMicPermission for mic control
  - lib/debate/segments.ts — LD_SEGMENTS 7-entry canonical schedule
affects:
  - 02-03 (createDebate uses pool + LD_SEGMENTS)
  - 02-04 (token endpoint uses mintToken)
  - 02-05 (debateStore uses LD_SEGMENTS)
  - 02-06 (transitions use setMicPermission)

tech-stack:
  added: [livekit-server-sdk, livekit-client, "@livekit/components-react", "@livekit/components-styles", zustand]
  patterns:
    - "mintToken: role=speaker → canPublish=true/roomAdmin=false; role=moderator → canPublish=false/roomAdmin=true"
    - "setMicPermission uses updateParticipant (not mutePublishedTrack) — cleanly revokes/grants canPublish"
    - "pool.query lazy-initializes a singleton node-postgres Pool with SSL rejectUnauthorized:false (Supabase pooler pattern)"

key-files:
  created:
    - lib/db/pool.ts
    - lib/livekit/tokens.ts
    - lib/livekit/room-service.ts
    - lib/debate/segments.ts
  modified:
    - lib/env.ts
    - package.json
    - package-lock.json

key-decisions:
  - "LIVEKIT_* env vars are optional() in Zod schema — prevents startup failures in dev environments where LiveKit is not yet configured"
  - "mintToken must await toJwt() — returning the Promise directly is a LiveKit v2 foot-gun that produces malformed tokens"
  - "updateParticipant (not mutePublishedTrack) for mic control — canPublish revocation auto-unpublishes all tracks without needing track SID lookup"
  - ".env.example already contained LiveKit entries from Phase 1 provisioning — no duplicate entries added"
  - "pg and @types/pg already in package.json from earlier foundation work — no reinstall needed"

duration: 6 minutes
completed: 2026-04-21
---

# Phase 02-02: Runtime Dependencies + Primitives Summary

Installed livekit-server-sdk@2.15.1, livekit-client@2.18.4, @livekit/components-react@2.9.20, @livekit/components-styles@1.2.0, and zustand@4.5.7; then built four server-side primitive modules (pool.query helper, mintToken JWT factory, setMicPermission RoomServiceClient wrapper, and the canonical 7-segment LD_SEGMENTS schedule) that all downstream Phase 2 plans consume.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install deps, extend env, create pool helper | 74c04cf | package.json, package-lock.json, lib/env.ts, lib/db/pool.ts |
| 2 | LiveKit token minting and RoomServiceClient helpers | 9ed1976 | lib/livekit/tokens.ts, lib/livekit/room-service.ts |
| 3 | Lincoln-Douglas segment schedule constants | 30d354d | lib/debate/segments.ts |

## What Was Built

### lib/db/pool.ts
Singleton `pg.Pool` backed by `DATABASE_TRANSACTION_POOLER_URL` with `ssl: { rejectUnauthorized: false }` (required for Supabase transaction pooler).  Lazy-initializes on first `pool.query()` call so the module is safe to import in environments without a DB configured.

### lib/livekit/tokens.ts
`mintToken(input)` generates a LiveKit JWT with role-appropriate grants: speakers get `canPublish=true` and `roomAdmin=false`; moderators get `canPublish=false` and `roomAdmin=true`.  TTL defaults to 4 hours.  `toJwt()` is awaited — in livekit-server-sdk v2 this method is async and returning the Promise unwrapped causes LiveKit to reject the token as malformed.

### lib/livekit/room-service.ts
Singleton `RoomServiceClient` with a `setMicPermission(roomName, identity, canPublish)` wrapper.  Uses `updateParticipant` (not `mutePublishedTrack`) so the permission change is authoritative and persists for the duration of the session rather than toggling a single track.

### lib/debate/segments.ts
Canonical Lincoln-Douglas 7-segment schedule as `readonly LDSegment[]` with full TypeScript types.  All `segmentType` values match the `listening.debate_segments` CHECK constraint in the migration.  Exports:
- `LD_SEGMENTS` — 7-entry array (1920 total speaking seconds = 32 minutes)
- `LD_TOTAL_SPEAKING_SECONDS` = 1920
- `LD_PREP_TIME_SECONDS` = 240 (4 min each side)
- `LD_BONUS_TIME_SECONDS` = 60
- `getSegmentBySequence(n)` — bounds-checked accessor

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| LIVEKIT_* vars optional() in Zod | Prevents startup failure when running locally without LiveKit credentials; all callers throw at runtime if missing |
| await toJwt() mandatory | livekit-server-sdk v2 changed toJwt() to async; omitting await silently returns a Promise object that fails JWT parsing |
| updateParticipant over mutePublishedTrack | mutePublishedTrack requires a track SID lookup; updateParticipant's canPublish revocation works for all tracks and survives reconnects |
| .env.example already complete | LiveKit section existed from 01-02 service provisioning; no duplicate entries were added |

## Deviations from Plan

None — plan executed exactly as written.  Two observations worth noting:
1. The `.env.example` already contained LiveKit entries from the Phase 1 provisioning plan (01-02), so no additions were needed.
2. `pg` and `@types/pg` were already present in package.json from earlier foundation work, confirming the plan's note was accurate.

## Verification Results

- livekit-server-sdk@2.15.1 installed
- livekit-client@2.18.4 installed
- @livekit/components-react@2.9.20 installed
- @livekit/components-styles@1.2.0 installed
- zustand@4.5.7 installed
- lib/env.ts: 3 LIVEKIT_* vars added
- lib/db/pool.ts: DATABASE_TRANSACTION_POOLER_URL referenced (3 occurrences)
- lib/livekit/tokens.ts: toJwt() awaited, roomAdmin grant conditional on role=moderator
- lib/livekit/room-service.ts: updateParticipant called in setMicPermission
- lib/debate/segments.ts: 7 sequenceOrder entries, LD_TOTAL_SPEAKING_SECONDS=1920
- `npx tsc --noEmit` passes with no errors

## Next Phase Readiness

All Phase 2 downstream primitives are in place:
- **02-03** (createDebate): can import `pool` and `LD_SEGMENTS`
- **02-04** (token endpoint): can import `mintToken`
- **02-05** (debateStore): can import `LD_SEGMENTS` and Zustand
- **02-06** (transitions): can import `setMicPermission`
