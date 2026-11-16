---
phase: 05-notes
verified: null
status: pending
score: 0/12 checks run
re_verification: false
---

# Phase 5: Notes — Verification Runbook

**Phase Goal:** Connected accounts can take timestamped notes during a live debate; speakers see their notes as a rebuttal checklist; all notes can be exported as PDF
**Status:** pending — this is the script, not the report
**Blocks:** Phase 5 cannot be marked Complete until this passes

This covers 05-05 Task 3, the human-verify gate the plan marks `autonomous: false`.
Plans 05-01 … 05-04 were verified at the time they shipped; what has never been
exercised is the speaker surface, because `userRole` only became load-bearing in 05-05.

## Before you start

**You do not need Mux.** `ObserverShell.tsx:75` resolves `hlsUrl` to null when there is no
`mux_playback_id`, and the observer page renders with **"Stream unavailable."** where the video
would be. The segment timeline, transcript panel and notes panel all work. A black video box is
the expected state of this run, not a failure.

**You do need a real debate**: a moderator and two speakers in a LiveKit room with transcription
running, which has worked since the Phase 2 E2E on 2026-04-22.

**Three people, two browsers minimum.** The speaker and the observer must be different accounts
in different sessions — one browser profile each, or one normal and one private window. The
whole point is to prove the role gate, and sharing a session defeats it.

| who | opens | why |
|---|---|---|
| moderator | `/join/moderator/<debateId>?s=…` then `/debates/<debateId>` | drives segments; also check #3 and #4 |
| speaker (affirmative) | `/join/speaker/<debateId>?s=…` then `/debates/<debateId>` | the surface under test |
| observer | `/debates/<debateId>` | must NOT see speaker affordances |

**Note the speaker opens the observer URL too.** The rebuttal checklist lives in the notes panel
on `/debates/[debateId]`, not in the speaker room — `useUserRole()` is what distinguishes them.
That is the design, and it is also the thing most likely to surprise you.

**Keep a console open on every tab.** Several failure modes here are silent by construction:
promote and demote roll back on a failed write and log to console rather than showing a toast.

## Checks

Record PASS / FAIL / SKIPPED and what you actually saw.

### Identity and role gating

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Speaker opens `/debates/<debateId>` | Notes panel shows a **"Rebuttal checklist"** heading above an **"Other notes"** heading | |
| 2 | Observer opens the same URL | One flat notes list. No "Rebuttal checklist", no "+ Rebuttal" on hover | |
| 3 | Moderator opens the same URL | Same as the observer — flat list, no checklist | |
| 4 | Speaker selects transcript text | Floating **"Add to rebuttal list"** button appears near the selection | |
| 5 | Observer and moderator select transcript text | **No** popup appears | |

Checks 1 and 4 are the ones that answer the question behind PR #70. Before that fix, a
WorkOS-issued token resolved to the raw `sub`, never matched `debate_speakers.user_id`, and
every speaker was silently classified as an observer. **If check 1 fails, stop** — the identity
layer is still wrong and the rest of the run tells you nothing.

### The transcript → rebuttal path

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 6 | Speaker selects a line that has been on screen a while, clicks the button | Note appears in the checklist with a **❝** marker | |
| 7 | Speaker selects a line that was *just spoken* (still arriving live), clicks the button | Note is created. **No 400 in the console.** The ❝ marker may be absent — that is correct | |

Check 7 is the deviation flagged in PR #71. Broadcast-arriving entries carry a synthetic
`${speakerId}-${spokenAt}` id, but `source_transcript_entry_id` is a uuid FK, so the attribute
is emitted only for real UUIDs. An unanchored note is the intended outcome. A **400** is a
regression.

### The checklist

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 8 | Speaker types a note, hovers it, clicks **"+ Rebuttal"** | Moves from "Other notes" into the checklist, at the end | |
| 9 | Speaker drags an item to a new position, then **reloads** | New order survives the reload | |
| 10 | Speaker tabs to the **⠿** handle, presses Space, arrows, Space | Item moves without a mouse. Reload: order persists | |
| 11 | Speaker ticks a checkbox, then **reloads** | Line-through while ticked; **all boxes clear** on reload | |
| 12 | Speaker clicks **×** on an item | Returns to "Other notes" | |

Check 11 looks like a bug and is not: checkbox state is deliberately ephemeral. "Addressed" is a
within-segment working state, not a fact about the debate, so it lives in the store and is never
written to the database.

Check 9 is the one worth doing carefully. The reorder fires a single PUT to `/reorder` with the
full ordered id list, optimistically. **If the order snaps back after a moment, or the reload
shows the old order, check the console** — a failed write rolls the UI back and logs, silently.

### Regression and hygiene

| # | Check | Expected | Result |
|---|-------|----------|--------|
| R1 | Any signed-in user clicks **Export PDF** | PDF downloads, notes in debate-time order, unbroken by Phase 5 work | |
| R2 | Console on all three tabs | No errors. Rolled-back writes log here, so an empty console is part of the result | |

### Folded in from issue #69

PR #58 (bonus-time end-segment render side effect) merged before its own two-browser check.
Since you have the room open, settle it:

| # | Check | Expected | Result |
|---|-------|----------|--------|
| B1 | Let a speaker's allocated time expire into bonus, then end the segment | Timer renders correctly through the transition; no duplicated or frozen state on any surface | |

## Outcome

- **All PASS** → set `status: passed` and the date in the frontmatter above, write
  `05-05-SUMMARY.md` (frontmatter `subsystem: notes-rebuttal`, `requires: [05-04]`,
  `exports: [TranscriptSelectionPopup, RebuttalChecklist]`), flip Phase 5 to Complete in
  `ROADMAP.md` and `STATE.md`, tick **NOTES-03** in `REQUIREMENTS.md`, and close issue #69.
- **Any FAIL** → record what you saw here and stop. Phase 5 stays open.

## Known not covered

- The Mux egress path. Still unproven, still deferred, and out of scope for this run.
- Mobile. 05-05 was built against both layouts but the drag interaction has not been exercised
  on a touch screen, and `PointerSensor` with a 4px activation distance may fight the scroll
  container.
