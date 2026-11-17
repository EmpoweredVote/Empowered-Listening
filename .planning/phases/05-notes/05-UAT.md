---
status: testing
phase: 05-notes
source: [05-VERIFICATION.md, 05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md]
started: 2026-11-16T15:24:00Z
updated: 2026-11-16T15:24:00Z
against_commit: f4c8991
---

## Run conditions

Run against production `https://listening.empowered.vote` at commit `f4c8991`
(deploy `dep-dbtht5uq1p3s7380oh0g`, live 15:19:30Z). Health endpoint returned
200 before the sitting started.

**PRs #75 and #76 are deliberately NOT in this build.** That is the point of
holding them. Two consequences for the run:

- Segment auto-expire is still client-side. **The moderator tab must stay open
  and focused enough to keep timers running** — closing it freezes the debate.
- The bonus pool does not decrement across segments (the bug #75 fixes). B1 is
  about render behaviour through the transition, not pool arithmetic, so it is
  still a valid check — but a pool that looks too generous is expected here.

**No debate exists to run.** Every `scheduled` and `live` debate was closed out
earlier today (migration `20261116010000` plus the cancelled test debate). A
fresh debate must be created at `/moderator/new`. This is the right starting
state for a clean run, not an obstacle.

## Current Test

number: 1
name: Speaker sees the rebuttal checklist
expected: |
  Speaker opens /debates/<debateId> — the SAME url the observer uses, not the
  speaker room. The notes panel shows a "Rebuttal checklist" heading above an
  "Other notes" heading.
awaiting: user response

**Check 1 is stop-the-run.** It is the question behind PR #70: a WorkOS-issued
token used to resolve to the raw `sub`, never match `debate_speakers.user_id`,
and silently classify every speaker as an observer. If this fails, the identity
layer is still wrong and nothing after it means anything.

## Tests

### 1. Speaker sees the rebuttal checklist
expected: Notes panel shows "Rebuttal checklist" above "Other notes"
result: [pending]

### 2. Observer sees a flat list
expected: One flat notes list. No "Rebuttal checklist", no "+ Rebuttal" on hover
result: [pending]

### 3. Moderator sees a flat list
expected: Same as observer — flat list, no checklist
result: [pending]

### 4. Speaker transcript selection offers the popup
expected: Floating "Add to rebuttal list" button appears near the selection
result: [pending]

### 5. Observer and moderator selection offers nothing
expected: No popup appears for either
result: [pending]

### 6. Settled transcript line to checklist
expected: Note appears in checklist with a ❝ marker
result: [pending]

### 7. Live-arriving transcript line to checklist
expected: Note created, no 400 in console. ❝ marker may be absent — correct
result: [pending]

### 8. Promote a note to the checklist
expected: Moves from "Other notes" into the checklist, at the end
result: [pending]

### 9. Drag to reorder survives reload
expected: New order persists after reload
result: [pending]

### 10. Keyboard reorder survives reload
expected: ⠿ handle, Space, arrows, Space moves item. Order persists on reload
result: [pending]

### 11. Checkbox state is ephemeral
expected: Line-through while ticked; ALL boxes clear on reload (by design)
result: [pending]

### 12. Demote an item off the checklist
expected: × returns the item to "Other notes"
result: [pending]

### R1. PDF export unbroken
expected: PDF downloads, notes in debate-time order
result: [pending]

### R2. Console clean on all three tabs
expected: No errors. Rolled-back writes log here, so empty console is the result
result: [pending]

### B1. Bonus-time transition render (issue #69)
expected: Timer renders correctly through expiry into bonus and the segment end;
  no duplicated or frozen state on any surface
result: [pending]
