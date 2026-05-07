---
phase: 05-notes
plan: 04
subsystem: notes-observer-ui
tags: [react, zustand, notes, pdf-export, keyboard-shortcuts, tailwind]

# Dependency graph
requires:
  - phase: 05-02
    provides: Notes CRUD API + notesStore Zustand store + NoteRow type
  - phase: 05-03
    provides: PDF export route + alignNotesToTranscript + DebateNotesPdf component
provides:
  - useUserRole hook (userId, displayName, userRole, tier, token, loading from session + debate store)
  - NoteInput component (Enter-to-save, Shift+Enter newline, inline error, debate_time_mmss stamping)
  - NoteItem component (idle/edit modes, inline PUT, confirmed DELETE, hover affordances)
  - NotesPanel component (header, scrollable list, tier-gated input region, PDF export blob download)
  - DesktopLayout and MobileLayout wired to NotesPanel (replaces placeholder)
  - N keyboard shortcut dispatches notes:focus-input custom event
affects: [05-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Custom event bus (notes:focus-input) to decouple keyboard handler in layout from NotesPanel input state"
    - "Blob-URL anchor click pattern for bearer-authenticated file downloads"
    - "useUserRole: tier fetched from /api/account/me; role derived from debateStore speakers; both cached in component state"
    - "getState() call pattern for accessing Zustand store outside React render (computeDebateTimeMmss in save())"

key-files:
  created:
    - hooks/useUserRole.ts
    - components/notes/NoteInput.tsx
    - components/notes/NoteItem.tsx
    - components/notes/NotesPanel.tsx
  modified:
    - app/debates/[debateId]/DesktopLayout.tsx
    - app/debates/[debateId]/MobileLayout.tsx

key-decisions:
  - "Custom event 'notes:focus-input' from DesktopLayout's N handler → NotesPanel opens input — decouples without prop drilling"
  - "useUserRole fetches tier inline (not via SessionProvider) to keep SessionProvider lightweight; brief null tier is acceptable"
  - "Export PDF via fetch → blob → object URL → anchor click (not plain <a href>) because route requires Authorization header"
  - "N shortcut guard mirrors existing keyboard shortcut guard in DesktopLayout — no input/textarea/contenteditable target"
  - "NoteInput uses getState() (not reactive subscription) to read active segment at save time — avoids re-render churn"

patterns-established:
  - "Tier gate pattern: canTakeNotes = token && (tier === 'connected' || tier === 'empowered')"
  - "isAnonymous = !token && !loading (not just !token — avoids flash of upgrade message during loading)"
  - "useRef single-flight guard for in-flight saves is superseded by setSaving(true) pattern with disabled textarea"

# Metrics
duration: ~35min
completed: 2026-04-27
---

# Phase 5 Plan 04: Notes Observer UI Summary

**NotesPanel with keyboard-shortcut-driven NoteInput, inline edit/delete NoteItem, PDF export blob download, and useUserRole hook — wired into DesktopLayout and MobileLayout, replacing all Phase 5 placeholders**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-27
- **Completed:** 2026-04-27
- **Tasks:** 2 implementation + 1 checkpoint (human-verify, approved)
- **Files modified:** 6

## Accomplishments

- useUserRole hook derives role (anonymous/observer/speaker/moderator) from debateStore speakers and tier from /api/account/me, returning unified state for gating decisions
- NotesPanel + NoteInput + NoteItem provide the complete note-taking surface: create with debate_time_mmss stamp, inline edit with is_edited indicator, confirmed delete, PDF export via bearer-authenticated blob download
- DesktopLayout N shortcut dispatches 'notes:focus-input' custom event; NotesPanel listens and opens input — fully decoupled without prop drilling through ObserverShell

## Task Commits

Each task was committed atomically:

1. **Task 1: useUserRole hook + NoteInput + NoteItem components** - `d56028c` (feat)
2. **Task 2: NotesPanel + wire into both layouts** - `92af164` (feat)

## Files Created/Modified

- `hooks/useUserRole.ts` - Derives userId (decodeJwt), userRole (debateStore speakers match), tier (fetch /api/account/me), returns unified UserRoleState
- `components/notes/NoteInput.tsx` - Textarea with Enter-saves/Shift+Enter-newline, debate_time_mmss stamping via getActiveSegment, inline error auto-clear
- `components/notes/NoteItem.tsx` - Idle/edit mode card, hover-revealed Edit+Delete, PUT on save, window.confirm + DELETE on delete, (edited) indicator
- `components/notes/NotesPanel.tsx` - Full panel: header with "+ Add note" + "Export PDF", scrollable NoteRow list, tier-gated input region, notes:focus-input listener
- `app/debates/[debateId]/DesktopLayout.tsx` - N case dispatches 'notes:focus-input' + focuses notesPanelRef; placeholder div replaced with <NotesPanel debateId={debateId} />
- `app/debates/[debateId]/MobileLayout.tsx` - Notes tab content replaced with <NotesPanel debateId={debateId} />

## Decisions Made

- **Custom event decoupling:** DesktopLayout owns keyboard handler and dispatches `notes:focus-input`; NotesPanel listens and sets `inputOpen=true`.  This avoids adding a callback prop to NotesPanel or threading focus state through ObserverShell.
- **Tier fetched in useUserRole, not SessionProvider:** SessionProvider already fetches display_name; adding tier there would bloat the shared context.  useUserRole's local state is acceptable since only note-taking surfaces need it.
- **Blob URL download for export:** `/api/debates/[id]/notes/export` requires Authorization header — a plain `<a href>` cannot send it.  The fetch → blob → object URL → anchor click pattern is the correct workaround.
- **isAnonymous guard:** `!token && !loading` prevents the "Sign in to take notes" message from flashing before session loads.

## Deviations from Plan

None — plan executed exactly as written.  Both layout files already imported NotesPanel from a previous partial implementation; the commit history shows tasks were completed before the checkpoint was reached.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- NotesPanel exports `NotesPanel` and `useUserRole` / `UserRole` for Plan 05-05 use
- Plan 05-05 (speaker rebuttal checklist) can mount a `RebuttalChecklist` inside NotesPanel when `userRole === 'speaker'` — the hook and panel are ready for that extension
- No blockers for 05-05

---
*Phase: 05-notes*
*Completed: 2026-04-27*
