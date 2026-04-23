---
phase: 04-transcription
plan: "02"
subsystem: api
tags: [deepgram, livekit, rtc-node, transcription, websocket, supabase-broadcast, postgres]

# Dependency graph
requires:
  - phase: 04-01
    provides: DEEPGRAM_API_KEY in env.ts, worker token in mintToken, computeDebateTimeMmss
  - phase: 03-01
    provides: Mux egress lifecycle in segments route (where worker hooks are inserted)
  - phase: 02-02
    provides: LiveKit room join, mintToken, livekit_identity in debate_speakers
provides:
  - DeepgramLiveConnection class (per-speaker PCM streaming to Deepgram Nova-3)
  - TranscriptionWorker class (LiveKit room join, track management, reconnect)
  - activeWorkers singleton registry (shared between routes)
  - GET/POST /api/debates/:debateId/transcription (status, start, stop)
  - Lifecycle wiring in segments route (auto-start on first segment, auto-stop on completion)
affects: [04-03, 04-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deepgram SDK v5: DefaultDeepgramClient + listen.v1.connect() (async) returning V1Socket"
    - "Int16Array-to-Buffer conversion before sendMedia() for PCM audio"
    - "Singleton registry pattern for cross-module worker state sharing"
    - "Node.js runtime export on routes using @livekit/rtc-node native bindings"
    - "Broadcast-and-dispose: create Supabase channel, send, removeChannel (no persistent socket)"

key-files:
  created:
    - lib/transcription/deepgram-connection.ts
    - lib/transcription/worker.ts
    - lib/transcription/registry.ts
    - app/api/debates/[debateId]/transcription/route.ts
  modified:
    - app/api/debates/[debateId]/segments/[segmentId]/route.ts

key-decisions:
  - "Deepgram SDK v5 uses DefaultDeepgramClient (not createClient); listen.v1 is a property getter, not a method; connect() is async"
  - "V5 SDK booleans must be passed as string literals 'true'/'false' for interim_results, smart_format, punctuate"
  - "filler_words not in v5 ConnectArgs; passed via extra query param object"
  - "RoomOptions requires both autoSubscribe and dynacast fields (dynacast: false for subscriber-only worker)"
  - "V1Socket.sendMedia() is the correct send method in v5 (not send() as in older plan pseudocode)"
  - "V1Socket.close() is the correct disconnect method (not finish())"

patterns-established:
  - "Worker lifecycle: bootstrap after egress in segments route start action; teardown in segments route end action when status=completed"
  - "Registry singleton: import activeWorkers from @/lib/transcription/registry in both route files"
  - "export const runtime = 'nodejs' required on any route importing @livekit/rtc-node"

# Metrics
duration: 14min
completed: 2026-04-23
---

# Phase 4 Plan 02: Transcription Worker Core Summary

**Deepgram Nova-3 live transcription worker: DeepgramLiveConnection (PCM streaming via SDK v5), TranscriptionWorker (LiveKit room join with per-speaker connections), singleton registry, start/stop API, and automatic lifecycle wiring into the segments route**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-23T14:16:49Z
- **Completed:** 2026-04-23T14:30:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- DeepgramLiveConnection: connects to Deepgram Nova-3 via SDK v5, streams 16kHz PCM, filters by confidence thresholds, inserts to DB, broadcasts interim/final via Supabase, reconnects with exponential backoff
- TranscriptionWorker: joins LiveKit room server-side via @livekit/rtc-node, creates per-speaker connections on TrackSubscribed, handles room disconnect with 2s reconnect
- Automatic lifecycle: transcription worker starts with first debate segment and stops when debate completes — no manual API call needed in normal flow

## Task Commits

Each task was committed atomically:

1. **Task 1: DeepgramLiveConnection** - `26b250d` (feat)
2. **Task 2: TranscriptionWorker + registry + API route + lifecycle wiring** - `605e20c` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `lib/transcription/deepgram-connection.ts` - Per-speaker Deepgram WebSocket connection; PCM streaming, confidence filtering, DB insert, Supabase broadcast
- `lib/transcription/worker.ts` - TranscriptionWorker class; LiveKit room join via @livekit/rtc-node; creates/destroys DeepgramLiveConnection per speaker track
- `lib/transcription/registry.ts` - Singleton `activeWorkers` Map shared between transcription route and segments route
- `app/api/debates/[debateId]/transcription/route.ts` - GET (status), POST (start/stop) with Node.js runtime and moderator auth
- `app/api/debates/[debateId]/segments/[segmentId]/route.ts` - Added worker bootstrap on first-segment start and worker stop on debate completion

## Decisions Made

1. **Deepgram SDK v5 API shape differs from plan pseudocode**: `createClient` doesn't exist; use `DefaultDeepgramClient`. `listen.v1` is a getter property (not a method call); `connect()` is async returning `Promise<V1Socket>`. The correct send method is `sendMedia()` and disconnect is `close()`. Plan pseudocode was written for an earlier SDK version.

2. **V5 SDK booleans are string literals**: `interim_results`, `smart_format`, `punctuate` must be `'true'`/`'false'` strings, not JS booleans — the SDK types are string-enum unions.

3. **`filler_words` not in v5 ConnectArgs**: Passed via `extra` query params object since it's not a typed parameter in v5's generated client.

4. **RoomOptions requires `dynacast` field**: The `@livekit/rtc-node` `RoomOptions` interface requires both `autoSubscribe` and `dynacast`; used `dynacast: false` since the worker is subscribe-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Deepgram SDK v5 API shape mismatch**

- **Found during:** Task 1 (DeepgramLiveConnection implementation)
- **Issue:** Plan pseudocode used `createClient()` (doesn't exist in v5), `listen.v1()` as a function call (it's a getter property), `.live()` method (doesn't exist), `.send()` for audio (should be `.sendMedia()`), and `.finish()` to disconnect (should be `.close()`)
- **Fix:** Used actual v5 SDK: `new DefaultDeepgramClient()`, `client.listen.v1.connect()` (async), `socket.sendMedia()`, `socket.close()`; used typed `V1Socket.Response` union for message handler
- **Files modified:** lib/transcription/deepgram-connection.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 26b250d (Task 1 commit)

**2. [Rule 1 - Bug] V5 SDK boolean parameters require string literals**

- **Found during:** Task 1 (tsc error TS2322)
- **Issue:** `interim_results: true`, `smart_format: false`, `punctuate: false` — SDK types are string enums (`'true'`/`'false'`), not booleans
- **Fix:** Changed to string literals `'true'`/`'false'`
- **Files modified:** lib/transcription/deepgram-connection.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 26b250d (Task 1 commit)

**3. [Rule 1 - Bug] `filler_words` not in v5 ConnectArgs**

- **Found during:** Task 1 (tsc error TS2353)
- **Issue:** `filler_words` is not a recognized parameter in v5 SDK's typed `ConnectArgs` interface
- **Fix:** Passed via `extra: { filler_words: 'true' }` query parameter object
- **Files modified:** lib/transcription/deepgram-connection.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 26b250d (Task 1 commit)

**4. [Rule 1 - Bug] RoomOptions requires dynacast field**

- **Found during:** Task 2 (tsc error TS2345)
- **Issue:** `@livekit/rtc-node` RoomOptions interface requires both `autoSubscribe` and `dynacast` — plan only specified `autoSubscribe`
- **Fix:** Added `dynacast: false` (worker is subscribe-only, no simulcast needed)
- **Files modified:** lib/transcription/worker.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 605e20c (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 1 - SDK version mismatch bugs)
**Impact on plan:** All fixes necessary for correct SDK usage. No scope creep. The plan was written against an older Deepgram SDK API; actual v5 shapes required adaptation.

## Issues Encountered

None beyond the SDK version mismatches documented in Deviations.

## User Setup Required

None - no new external service configuration required.  DEEPGRAM_API_KEY and LIVEKIT_URL were already established in Phase 4-01 and Phase 2-02 respectively.

## Next Phase Readiness

- 04-03 (observer transcript panel) is already complete — it builds on the broadcast events this worker now produces
- 04-04 (transcript search and export) can proceed: `transcript_entries` table is populated by this worker
- Integration testing requires a live debate with two speakers to validate end-to-end audio→transcript flow

---
*Phase: 04-transcription*
*Completed: 2026-04-23*
