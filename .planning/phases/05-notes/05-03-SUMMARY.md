---
phase: 05-notes
plan: 03
subsystem: notes-pdf
tags: [react-pdf, typescript, vitest, alignment-algorithm, pdf-export, postgres]

# Dependency graph
requires:
  - phase: 05-01
    provides: "@react-pdf/renderer@4.5.1 installed; listening.notes schema with all Phase 5 columns"
provides:
  - alignNotesToTranscript pure function mapping notes to nearest-earlier transcript entries
  - DebateNotesPdf @react-pdf/renderer Document component with two-column layout
  - GET /api/debates/[debateId]/notes/export returning application/pdf buffer
  - 8 Vitest unit tests covering all alignment algorithm edge cases
affects: [05-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "renderToBuffer type cast: as unknown as ReactElement<DocumentProps> bridges DebateNotesPdf component props to react-pdf's narrower DocumentProps constraint"
    - "Binary search for nearest-earlier transcript alignment: O(log n) lookup via sorted transcript copy; original indices preserved"
    - "Parallel Promise.all for debate/speakers/transcript/notes queries; separate speaker-by-id lookup for transcript label resolution"
    - "export const runtime = 'nodejs' on renderToBuffer routes — required for Node-native PDF rendering"

key-files:
  created:
    - lib/notes/align-notes-to-transcript.ts
    - lib/notes/align-notes-to-transcript.test.ts
    - components/pdf/DebateNotesPdf.tsx
    - app/api/debates/[debateId]/notes/export/route.ts
  modified: []

key-decisions:
  - "Type cast as unknown as ReactElement<DocumentProps> — renderToBuffer expects DocumentProps-rooted element; DebateNotesPdf wraps Document at runtime but TS sees DebateNotesPdfProps; cast is safe and avoids re-architecting the component boundary"
  - "Binary search in alignNotesToTranscript — transcript is sorted once; O(log n) per note vs O(n) linear scan; inputs not mutated"
  - "Separate speaker-by-id query in export route — transcript_entries reference speaker_id (UUID); a second query with id included resolves label mapping cleanly without restructuring the parallel fetch"

patterns-established:
  - "alignedTranscriptIndex=-1 convention: notes with null timestamps or no earlier entry use -1 as sentinel; DebateNotesPdf renders them at the top of the notes column"
  - "PDF component is server-only (no 'use client'): imported directly by Node runtime route handler; comment at top of file makes this explicit"

# Metrics
duration: 15min
completed: 2026-04-27
---

# Phase 5 Plan 03: PDF Export Summary

**@react-pdf/renderer two-column debate notes PDF: pure alignment algorithm (binary search, 8 tests), DebateNotesPdf Document component, and Node-runtime GET route returning application/pdf**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-27T17:00:00Z
- **Completed:** 2026-04-27T17:05:30Z
- **Tasks:** 3
- **Files modified:** 4 created

## Accomplishments

- Pure `alignNotesToTranscript` function with binary search correctly maps each note to the nearest-earlier transcript entry; 8 Vitest cases cover empty inputs, null timestamps, exact match, between-entries, before-first-entry, input order preservation, and no-mutation guarantee
- `DebateNotesPdf` renders A4 page with bold title header, grey metadata row (date · Aff · Neg · Mod · Exported by), and two-column body: transcript (flex 2) left, notes (flex 1) right with 1px divider; pre-first-entry notes render at top; edited notes show "(edited)" suffix
- `GET /api/debates/[debateId]/notes/export` returns `application/pdf` with `Content-Disposition: attachment`; 401 for missing/invalid token, 404 for unknown debate, 500 with `[notes-export]` logging on unhandled error

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure alignment function with tests** - `fe4e4e2` (feat)
2. **Task 2: DebateNotesPdf Document component** - `d381694` (feat)
3. **Task 3: PDF export route handler** - `5ff1849` (feat)

## Files Created/Modified

- `lib/notes/align-notes-to-transcript.ts` — Pure alignment function; exports `alignNotesToTranscript`, `AlignedNote`, `NoteForAlignment`, `TranscriptForAlignment`
- `lib/notes/align-notes-to-transcript.test.ts` — 8 Vitest test cases for alignment algorithm
- `components/pdf/DebateNotesPdf.tsx` — `@react-pdf/renderer` Document component; server-only (no `'use client'`)
- `app/api/debates/[debateId]/notes/export/route.ts` — Node runtime GET handler; parallel DB queries, PDF buffer response

## Decisions Made

- **Type cast for renderToBuffer:** `@react-pdf/renderer`'s `renderToBuffer` is typed to accept `ReactElement<DocumentProps>` — the Document element itself, not a component that wraps it.  `DebateNotesPdf` returns a `<Document>` root at runtime, satisfying the contract.  The type cast `as unknown as ReactElement<DocumentProps>` bridges the gap without restructuring the component boundary.  This is a TS-only concern; runtime behavior is correct.
- **Binary search in alignment function:** Transcript is sorted once (O(n log n)) then each note uses binary search (O(log n)).  Preserves original transcript indices after sorting via `originalIndex` field tracked in the sorted copy.
- **Separate speaker-by-id query in route:** `transcript_entries` records reference `speaker_id` (UUID FK).  The parallel `debate_speakers` query returns role/display_name but not `id`.  A second query that includes `id` resolves transcript-entry-to-speaker label mapping.  The extra query is cheap and keeps the parallel fetch clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type cast for renderToBuffer ReactElement<DocumentProps> mismatch**

- **Found during:** Task 3 (PDF export route handler)
- **Issue:** TypeScript error: `Argument of type 'FunctionComponentElement<DebateNotesPdfProps>'` is not assignable to `ReactElement<DocumentProps>`.  `renderToBuffer` requires the element's props to satisfy `DocumentProps` — our component uses `DebateNotesPdfProps`.
- **Fix:** Added `as unknown as React.ReactElement<DocumentProps>` cast in route handler.  Runtime behavior unchanged — `DebateNotesPdf` renders `<Document>` root; cast is purely a TypeScript bridge.
- **Files modified:** `app/api/debates/[debateId]/notes/export/route.ts`
- **Verification:** `npm run build` succeeds; TypeScript type check passes; route listed in build output.
- **Committed in:** `5ff1849` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 type error — TS generic narrowing gap in react-pdf)
**Impact on plan:** Necessary fix for compilation.  Zero runtime scope change.

## Issues Encountered

None beyond the type cast deviation above.

## User Setup Required

None — no new external service configuration.  Route uses existing `DATABASE_TRANSACTION_POOLER_URL`, `JWKS_URL`, and `getAccountMe` from the accounts API already configured in Phase 1.

## Next Phase Readiness

- 05-04 (Notes UI — NotesSidebar, NoteCard, drag-and-drop reorder) is unblocked.  It does not depend on the PDF export route directly.
- 05-04 may optionally add an "Export PDF" button that calls `GET /api/debates/[debateId]/notes/export` with the user's bearer token.
- No blockers.

---
*Phase: 05-notes*
*Completed: 2026-04-27*
