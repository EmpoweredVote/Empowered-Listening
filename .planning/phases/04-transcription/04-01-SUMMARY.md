---
phase: 04-transcription
plan: "01"
subsystem: infra
tags: [deepgram, livekit, transcription, tdd, vitest, env-validation]

# Dependency graph
requires:
  - phase: 02-speaker-room
    provides: mintToken and ParticipantRole used in tokens.ts extension
  - phase: 03-observer-streaming
    provides: lib/env.ts pattern (z.string().min(1) fail-fast) established for MUX_TOKEN_ID
provides:
  - DEEPGRAM_API_KEY validated at startup via lib/env.ts — server refuses to start if missing
  - worker role in mintToken — subscribe-only LiveKit token for transcription worker identity
  - computeDebateTimeMmss — wall-clock debate elapsed time as mm:ss string
  - vitest test infrastructure with globals and path alias configured
affects:
  - 04-02 (transcription worker — uses worker role token and computeDebateTimeMmss)
  - 04-03 (transcript storage — downstream of worker)
  - 04-04 (transcript display — downstream of storage)

# Tech tracking
tech-stack:
  added:
    - "@deepgram/sdk ^5.0.0 — Deepgram Nova-3 live transcription SDK"
    - "@livekit/rtc-node ^0.13.25 — LiveKit real-time Node.js SDK for worker"
    - "vitest ^4.1.5 — test runner (globals + node environment)"
  patterns:
    - "TDD RED-GREEN cycle: write failing tests, commit, implement, verify all pass, commit"
    - "vitest/globals triple-slash reference in test files for TypeScript compatibility"
    - "vitest.config.ts with globals:true and @ path alias for Next.js compatibility"

key-files:
  created:
    - lib/transcription/debate-time.ts
    - lib/transcription/debate-time.test.ts
    - vitest.config.ts
  modified:
    - lib/env.ts
    - lib/livekit/tokens.ts
    - package.json

key-decisions:
  - "DEEPGRAM_API_KEY uses z.string().min(1) — same fail-fast pattern as MUX_TOKEN_ID; server refuses to start without it"
  - "worker role: canPublish=false, canPublishData=false, roomAdmin=false — subscribe-only LiveKit token"
  - "computeDebateTimeMmss uses wall-clock difference NOT Deepgram word.start timestamps — avoids reset-on-reconnect bugs"
  - "vitest/globals triple-slash reference chosen over tsconfig types array — avoids restricting Next.js type auto-discovery"

patterns-established:
  - "TDD RED-GREEN with separate atomic commits (test → feat) for each feature"
  - "vitest as test runner: npx vitest run for CI-style single-pass execution"
  - "lib/transcription/ as the module root for all Phase 4 transcription logic"

# Metrics
duration: 6min
completed: 2026-04-23
---

# Phase 4 Plan 01: Worker Foundation Summary

**DEEPGRAM_API_KEY fail-fast validation, worker-role LiveKit token, and computeDebateTimeMmss with 6 passing TDD tests — three foundations for the transcription pipeline**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-23T14:04:49Z
- **Completed:** 2026-04-23T14:11:11Z
- **Tasks:** 2 (Task 1: packages/env/tokens; Task 2 TDD: computeDebateTimeMmss)
- **Files modified:** 6

## Accomplishments

- Installed `@deepgram/sdk` and `@livekit/rtc-node`; added `DEEPGRAM_API_KEY: z.string().min(1)` to `lib/env.ts` — server crashes fast at boot if key is absent
- Extended `ParticipantRole` with `'worker'` and wired `VideoGrant` so worker tokens are subscribe-only (canPublish=false, canPublishData=false, roomAdmin=false)
- TDD-implemented `computeDebateTimeMmss` — wall-clock elapsed time as zero-padded `mm:ss`, all 6 cases passing including clock-skew guard
- Installed and configured Vitest (globals, node env, @ path alias) as the project test runner

## Task Commits

Each task was committed atomically:

1. **Task 1: Install packages and wire DEEPGRAM_API_KEY + worker token** - `1b1a2d4` (feat)
2. **Task 2 RED: Add failing tests for computeDebateTimeMmss** - `326e1be` (test)
3. **Task 2 GREEN: Implement computeDebateTimeMmss** - `06e97b3` (feat)

_Note: TDD task has two commits (test → feat) per protocol_

## Files Created/Modified

- `lib/env.ts` — added `DEEPGRAM_API_KEY: z.string().min(1)` after LiveKit block
- `lib/livekit/tokens.ts` — `ParticipantRole` extended with `'worker'`; VideoGrant updated for worker grants
- `package.json` — added `@deepgram/sdk`, `@livekit/rtc-node`, `vitest`; added `"test": "vitest run"` script
- `lib/transcription/debate-time.ts` — exports `computeDebateTimeMmss`
- `lib/transcription/debate-time.test.ts` — 6 TDD test cases with vitest/globals triple-slash reference
- `vitest.config.ts` — globals:true, node environment, @ path alias

## Decisions Made

- **DEEPGRAM_API_KEY required (not optional):** `z.string().min(1)` matches the MUX_TOKEN_ID pattern — missing key crashes at startup, not silently at transcription time.
- **worker VideoGrant:** `canPublish=false, canPublishData=false, roomAdmin=false` — worker identity `transcription-worker:${debateId}` is subscribe-only; no room admin rights.
- **Wall-clock for debate_time_mmss:** `spokenAt.getTime() - actualStart.getTime()` using system timestamps rather than Deepgram `word.start` — Deepgram resets on reconnect, wall-clock does not.
- **vitest/globals triple-slash reference:** Preferred over adding a `types` array to `tsconfig.json` — a types array would restrict TypeScript's auto-discovery and could break Next.js type resolution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added vitest.config.ts with globals enabled**
- **Found during:** Task 2 RED phase
- **Issue:** Vitest by default does not inject `describe`/`it`/`expect` as globals — test file threw `ReferenceError: describe is not defined`
- **Fix:** Created `vitest.config.ts` with `globals: true`, `environment: 'node'`, and `@` path alias
- **Files modified:** vitest.config.ts, package.json (test script)
- **Verification:** Tests ran and failed on assertions (correct RED behavior)
- **Committed in:** `326e1be` (RED phase commit)

**2. [Rule 3 - Blocking] Added `/// <reference types="vitest/globals" />` to test file**
- **Found during:** Task 2 GREEN phase (tsc --noEmit check)
- **Issue:** TypeScript didn't recognize `describe`/`it`/`expect` as globals even after vitest.config.ts; `tsc --noEmit` produced 12 TS2593/TS2304 errors
- **Fix:** Added triple-slash reference at top of `debate-time.test.ts` — picks up vitest type declarations without restricting tsconfig types array
- **Files modified:** lib/transcription/debate-time.test.ts
- **Verification:** `npx tsc --noEmit` exits 0 with no errors
- **Committed in:** `06e97b3` (GREEN phase commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking)
**Impact on plan:** Both fixes were necessary for test infrastructure to work.  No scope creep; vitest config is the standard minimal setup for a TypeScript project without Jest.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

**External service requires manual configuration before Phase 4 worker can run.**

Add to your environment (`.env.local` for local dev, Render env vars for production):

```
DEEPGRAM_API_KEY=<your-key>
```

Get it from: Deepgram Console → Project → API Keys → Create a new API key

The server will refuse to start (fast-fail via Zod) if `DEEPGRAM_API_KEY` is absent.

## Next Phase Readiness

- 04-02 (Transcription Worker) can proceed: worker role token available, computeDebateTimeMmss implemented, DEEPGRAM_API_KEY validated at boot
- All 6 TDD tests are green; `tsc --noEmit` is clean
- Vitest is configured for future test files in `lib/transcription/`

---
*Phase: 04-transcription*
*Completed: 2026-04-23*
