---
phase: 04-transcription
plan: "04"
subsystem: moderator-editor
tags: [transcript, correction, rpc, security-definer, moderator, supabase, nextjs, react]

# Dependency graph
requires:
  - phase: 04-transcription/04-01
    provides: transcript_entries table with text, original_text, speaker_id, debate_time_mmss columns
  - phase: 04-transcription/04-03
    provides: GET /api/debates/[debateId]/transcript endpoint; TranscriptPanel broadcast pattern
  - phase: 02-speaker-room
    provides: /moderator/[debateId] page skeleton; JWT role verification pattern
provides:
  - SECURITY DEFINER RPC correct_transcript_entry — safe write path from anon/authenticated roles into listening schema
  - PATCH /api/moderator/debates/[debateId]/transcript/[entryId] — authenticated correction endpoint; preserves original_text
  - /moderator/[debateId]/transcript page — moderator-only list view of all transcript entries
  - TranscriptEditor component — inline edit UX with optimistic update and error rollback
affects:
  - 05-notes (moderator pages pattern established here)
  - 06-search-export (transcript entries now have both text and original_text for search indexing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER RPC pattern for writes into non-public listening schema from Next.js API routes"
    - "original_text preservation — first correction call sets original_text from current text; subsequent calls leave original_text unchanged"
    - "Optimistic update with error rollback in TranscriptEditor — local state updates immediately, reverts on API error"

key-files:
  created:
    - supabase/migrations/20260423000001_correct_transcript_entry_rpc.sql
    - app/api/moderator/debates/[debateId]/transcript/[entryId]/route.ts
    - app/moderator/[debateId]/transcript/page.tsx
    - components/transcript/moderator/TranscriptEditor.tsx
  modified:
    - lib/deepgram-connection.ts
    - components/transcript/TranscriptPanel.tsx

key-decisions:
  - "SECURITY DEFINER RPC is the correct write path into listening schema — PostgREST does not expose non-public schemas; API routes use pool.query() which bypasses RLS"
  - "original_text set only on first correction (COALESCE(original_text, old_text)) — preserves the Deepgram-generated transcript even after repeated human edits"
  - "TranscriptEditor uses optimistic update — immediate local state change, revert on non-ok response"
  - "Moderator page loads full transcript via existing GET endpoint — no separate admin endpoint needed"
  - "Word-level confidence filtering removed — Deepgram word.confidence filtering caused truncated transcripts; full alt.transcript string used for final entries"

patterns-established:
  - "SECURITY DEFINER RPC pattern: migrate RPC in listening schema, grant EXECUTE to anon/authenticated, call via pool.query in API route"
  - "Moderator correction flow: optimistic local update → PATCH → revert on error → broadcast not needed (corrections visible on next TranscriptPanel load)"

# Metrics
duration: multi-session
completed: 2026-04-27
---

# Phase 4 Plan 04: Moderator Transcript Editor Summary

**SECURITY DEFINER RPC + PATCH correction endpoint + moderator transcript page with inline TranscriptEditor — moderators can correct any Deepgram entry while preserving the original auto-generated text**

## Performance

- **Duration:** Multi-session (live testing and bug-fix iterations included)
- **Started:** 2026-04-23
- **Completed:** 2026-04-27
- **Tasks:** 3 (2 implementation + 1 human checkpoint)
- **Files modified:** 6

## Accomplishments

- `correct_transcript_entry` SECURITY DEFINER RPC in `listening` schema; sets `original_text` from current `text` on first correction (COALESCE), then updates `text`; returns updated row; EXECUTE granted to anon and authenticated roles
- PATCH `/api/moderator/debates/[debateId]/transcript/[entryId]` verifies JWT role (listening_moderator), calls RPC via `pool.query`, returns updated entry
- `/moderator/[debateId]/transcript` page loads full entry list from existing GET endpoint and renders each with `TranscriptEditor`
- `TranscriptEditor` component: textarea with Save/Cancel, optimistic update with rollback, shows original Deepgram text below corrected text when `original_text` differs
- Live-testing fixes applied: confidence filtering removed, consecutive same-speaker merging added to TranscriptPanel, debug logs and health diagnostic endpoint cleaned up

## Task Commits

Each task was committed atomically:

1. **Task 1: SECURITY DEFINER RPC + correction route** - `635b291` (feat)
2. **Task 2: Moderator page + TranscriptEditor** - `ae436c6` (feat)
3. **Task 3: Human checkpoint** - approved (no commit)

**Live-testing fixes (committed during diagnosis, documented as deviations):**
- `e02523f` — fix: use full transcript text instead of word-confidence filtered version
- `efc3bda` — feat: merge consecutive same-speaker transcript entries in display
- `1f287ae` — chore: remove debug logs from worker and segments route
- `61d0eca` — chore: remove health diagnostic endpoint

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/20260423000001_correct_transcript_entry_rpc.sql` — SECURITY DEFINER RPC, EXECUTE grants, original_text preservation logic
- `app/api/moderator/debates/[debateId]/transcript/[entryId]/route.ts` — PATCH endpoint; JWT role check; pool.query RPC call
- `app/moderator/[debateId]/transcript/page.tsx` — server component; loads entries via GET endpoint; renders TranscriptEditor list
- `components/transcript/moderator/TranscriptEditor.tsx` — inline edit with optimistic update, error rollback, original_text display
- `lib/deepgram-connection.ts` — removed word-level confidence filtering; full alt.transcript used for final entries
- `components/transcript/TranscriptPanel.tsx` — consecutive same-speaker entries merged in display layer

## Decisions Made

- **SECURITY DEFINER RPC for writes:** PostgREST does not expose the `listening` schema; all writes from API routes use `pool.query()` which runs as the database owner.  The RPC isolates the update logic inside the DB so the API route never builds raw SQL with user input.
- **COALESCE for original_text:** `original_text = COALESCE(original_text, text)` before overwriting `text` ensures the Deepgram-generated transcript is captured on the first edit and never overwritten again, even after repeated corrections.
- **Optimistic update in TranscriptEditor:** Improves perceived responsiveness; rollback on non-ok response keeps consistency without a full page reload.
- **No new broadcast on correction:** Corrections are visible on next TranscriptPanel mount via the GET snapshot; broadcasting each correction was out of scope for v1 and would require separate channel design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Word-level confidence filtering caused truncated final transcripts**

- **Found during:** Live testing after Task 1 and Task 2 were committed
- **Issue:** `lib/deepgram-connection.ts` filtered Deepgram words by `confidence >= 0.8` threshold and joined them, silently dropping low-confidence words and producing truncated or empty transcript entries
- **Fix:** Removed confidence filtering; use `alt.transcript` string directly for final entries
- **Files modified:** `lib/deepgram-connection.ts`
- **Verification:** Full sentences appear in transcript_entries; no truncation observed in live test
- **Committed in:** `e02523f`

**2. [Rule 2 - Missing Critical] Consecutive same-speaker merging in TranscriptPanel**

- **Found during:** Live testing — multiple short entries from same speaker displayed as visual clutter
- **Issue:** TranscriptPanel rendered each DB row as a separate entry even when the same speaker produced rapid consecutive segments, making the transcript hard to read
- **Fix:** Added display-layer merging: consecutive entries with the same `speaker_id` are concatenated with a space before rendering
- **Files modified:** `components/transcript/TranscriptPanel.tsx`
- **Verification:** Live transcript shows clean continuous speech blocks per speaker
- **Committed in:** `efc3bda`

**3. [Rule 1 - Bug] Debug logs and diagnostic endpoint left in production code**

- **Found during:** Live testing phase — logs added during diagnosis of Deepgram WebSocket issues
- **Issue:** `worker.ts` and the segments route contained diagnostic `console.log` calls; a health diagnostic HTTP endpoint was registered that should not exist in production
- **Fix:** Removed all debug logs from `worker.ts` and segments route; removed health diagnostic endpoint
- **Files modified:** `lib/worker.ts` (or equivalent), segments route, diagnostic endpoint file
- **Verification:** No debug output in production logs; endpoint returns 404
- **Committed in:** `1f287ae` (debug logs), `61d0eca` (diagnostic endpoint)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug — confidence filtering, 1 Rule 2 missing critical — speaker merging, 1 Rule 1 bug — debug cleanup)
**Impact on plan:** All fixes necessary for correct transcript output and production readiness.  No scope creep.

## Issues Encountered

- Deepgram word-confidence filtering was silently truncating transcripts — no error, just missing text.  Discovered only through live end-to-end testing.  Full `alt.transcript` string is reliable; per-word filtering adds noise without benefit at the display layer.
- Consecutive short entries from the same speaker required a display-layer merge rather than a DB-layer merge to keep the raw Deepgram data intact and auditable via `original_text`.

## User Setup Required

None - no external service configuration required for this plan.

## Next Phase Readiness

- Full transcript pipeline is complete: Deepgram STT → worker → broadcast → TranscriptPanel → moderator correction flow
- Phase 4 is complete.  All four plans delivered.
- Ready for Phase 5 (Notes) — moderator page pattern and transcript panel integration points established
- Ready for Phase 6 (Search/Export) — `original_text` preserved alongside corrected `text` for diff display and indexing
- No blockers

---
*Phase: 04-transcription*
*Completed: 2026-04-27*
