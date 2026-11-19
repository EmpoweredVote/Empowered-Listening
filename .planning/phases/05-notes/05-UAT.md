---
status: testing
phase: 05-notes
source: [05-VERIFICATION.md, 05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md]
started: 2026-11-16T15:24:00Z
updated: 2026-11-19T03:40:00Z
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
result: PASS 2026-11-18 — "Rebuttal checklist" renders above "Other notes" for the affirmative speaker

### 2. Observer sees a flat list
expected: One flat notes list. No "Rebuttal checklist", no "+ Rebuttal" on hover
result: [pending]

### 3. Moderator sees a flat list
expected: Same as observer — flat list, no checklist
result: PASS 2026-11-18 — moderator saw a flat "Notes" list, no checklist, no + Rebuttal (screenshot rebuttal.JPG)

### 4. Speaker transcript selection offers the popup
expected: Floating "Add to rebuttal list" button appears near the selection
result: PASS 2026-11-18 — selecting text in a settled transcript line on `80110ad3` surfaced the floating "Add to rebuttal list" button

### 5. Observer and moderator selection offers nothing
expected: No popup appears for either
result: PARTIAL 2026-11-18 — moderator half PASS: no popup on `d72df79a`, where the tester holds the moderator row. Observer half still blocked (needs a signed-in non-participant) — see check 2.

### 6. Settled transcript line to checklist
expected: Note appears in checklist with a ❝ marker
result: PASS 2026-11-18 — note landed in the checklist with the ❝ marker; DB shows rebuttal_order=0 and source_transcript_entry_id=1e259fe0-5f74-4f57-bf5e-db10083b27df (the marker renders off that column). Same row has `debate_time_mmss = NULL`: the quote keeps its link to the line but loses the line's time, so it exports above the transcript with no `@ mm:ss`. Filed as #101 — the check still passes, the export placement is the defect.

### 7. Live-arriving transcript line to checklist
expected: Note created, no 400 in console. ❝ marker may be absent — correct
result: BLOCKED — needs a live sitting. `80110ad3` is `completed`, so no transcript line can arrive while selecting.

### 8. Promote a note to the checklist
expected: Moves from "Other notes" into the checklist, at the end
result: PASS 2026-11-18 — alpha moved to the checklist; DB shows rebuttal_order=0, beta/charlie null

### 9. Drag to reorder survives reload
expected: New order persists after reload
result: PASS 2026-11-18 — dragged charlie to top; charlie/alpha/beta = 0/1/2 in DB and order held across reload

### 10. Keyboard reorder survives reload
expected: ⠿ handle, Space, arrows, Space moves item. Order persists on reload
result: PASS 2026-11-18 — Tab to handle, Space, arrows, Space moved beta to top; beta/charlie/alpha = 0/1/2 in DB, held across reload. Screen-reader announcement on pickup/drop NOT verified

### 11. Checkbox state is ephemeral
expected: Line-through while ticked; ALL boxes clear on reload (by design)
result: PASS 2026-11-18 — ticks showed line-through, all cleared on reload, order unchanged

### 12. Demote an item off the checklist
expected: × returns the item to "Other notes"
result: PASS 2026-11-18 — × returned charlie to Other notes (rebuttal_order null). Remaining items keep their indices (beta=0, alpha=2); the gap is by design, promote uses MAX+1 not count

### R1. PDF export unbroken
expected: PDF downloads, notes in debate-time order
result: FAIL 2026-11-18 — "Export failed. Please try again." Server: `[notes-export] error: column "scheduled_at" does not exist` (SQLSTATE 42703). The route selects `scheduled_at`; the column is `scheduled_start`. Broken for every debate and every user — the route has no test coverage. See issue #96.

  Fixed in #97 (`5702986`), deployed `dep-dbv4nkh42hec73b1cqig` live 01:08:48Z. Re-run 2026-11-18:
  the PDF now **downloads**, so the 500 is closed — but the export is unusable for a second,
  unrelated reason. Every transcript row is one word, so the PDF is a column of `AFF — JACKSON`
  headings one word apart. That is a transcription-layer defect, not a PDF one: all 27
  `transcript_entries` rows for `80110ad3` are word-level (`now` / `now` / `i` / `me` /
  `alright` / `so`), because the Deepgram connection inserted a row per `is_final` rather than
  per `speech_final`. The live transcript panel and the moderator review page read the same
  rows. Fixed in #98 (`6bcd18d`), deployed `dep-dbv6i9mq1p3s7383do30` live 03:14:04Z.

  **R1 stays open.** The grouping fix only affects rows written from now on; the stored rows for
  `80110ad3` are word-level and no export can regroup them. Closing R1 needs a fresh sitting
  recorded after `6bcd18d` — audio-only, so it costs no transcode minutes. Whether
  `endpointing: 500` puts the utterance boundary in the right place is a question about real
  speech that no unit test answers; `endpointing` is the knob if rows still come out choppy.
  Expect #101 to show on that run too — quoted notes will now quote a whole sentence and will
  still export above the transcript with no `@ mm:ss`.

### R2. Console clean on all three tabs
expected: No errors. Rolled-back writes log here, so empty console is the result
result: [pending]

### B1. Bonus-time transition render (issue #69)
expected: Timer renders correctly through expiry into bonus and the segment end;
  no duplicated or frozen state on any surface
result: [pending]

## Run note — checks 1, 3, 8–12 (2026-11-18)

Run against production at commit `18a09d6`.

Checks 8–12 need a **speaker** seat; the only tester available holds the
`moderator` row on every real debate, and `useUserRole` takes the *first*
matching speaker row, so holding both roles makes the result order-dependent
rather than wrong-but-predictable (filed as #100). Check 3 was recorded from
that same attempt — a moderator correctly saw a flat list with no checklist.

Fixture: the cancelled walkthrough debate `db5b2241` (no transcript, no notes)
was repurposed. Its `moderator` speaker row (`946393b7`) had `user_id` set to
NULL and the debate's status moved `cancelled` → `completed`, leaving the
tester matching only the `affirmative` seat. No other debate, transcript or
note was touched.

**REVERTED 2026-11-19.** Row `946393b7-f3cf-422e-9663-9ee06d940e01` restored to
`4e6dde8f-2bd0-4054-824f-4164744165ea`, and debate
`db5b2241-f540-494c-92f7-dea5fd7545fa` restored to `cancelled`.

Note for next time: the revert line originally written here named only the
`user_id` and omitted the status change, even though the paragraph above it
records both. A revert instruction that covers part of a fixture is worse than
none — it reads as complete. Write the fixture and its revert as one pair, and
state the full debate id rather than an 8-character prefix: `db5b2241` alone
matched nothing, and the row had to be found through the speaker id instead.

Still blocked, and why:
- **2** (observer flat list) — needs a signed-in non-participant.
- **4–7** (transcript selection → checklist) — need a speaker seat on a debate
  that *has* a transcript. `db5b2241` has none; the debates with transcripts
  have the tester as moderator.
- **R1, R2, B1** — R1/R2 not run; B1 needs a live sitting with a segment.

## Fixture — checks 4–7 (2026-11-18)

Checks 4–7 need a speaker seat on a debate that **has** a transcript. The
walkthrough debate `db5b2241` has none, so it could not serve here.

`80110ad3-e2c5-46f5-aff9-fea260109c86` ("Bainbridge should have a new ferry")
does. It ran for about a minute on 2026-11-18 and holds **27 transcript
entries**, all attributed to the `affirmative` seat (`Jackson`), because only
segment 1 — `affirmative_constructive` — ever started.

All three speaker rows on it pointed at the tester's own account, which is why
no rebuttal checklist appeared during the session: `useUserRole` takes the
*first* matching row, the `moderator` row was first, and `NotesPanel` gates the
checklist on `userRole === 'speaker'`. The checklist itself works as built — the
tester was simply never in the role it is for — but the first-match resolution
is its own defect, filed as #100.

Fixture: `user_id` set to NULL on the `moderator` row
(`e2444d67-e611-4eb4-b71e-b610552695c3`), leaving the tester matching the `negative` seat
first. That seat is the right one: the transcript is entirely the *affirmative's*
speech, so every entry is opponent material, which is what a rebuttal checklist
is built from. Verified through the live observer-snapshot — the client receives
`negative, affirmative, moderator(null)` and resolves `userRole = 'speaker'`.

**REVERTED 2026-11-19.** Row `e2444d67-e611-4eb4-b71e-b610552695c3` restored to
`4e6dde8f-2bd0-4054-824f-4164744165ea`.

While this fixture was in place the tester did **not** hold the moderator row on
`80110ad3`, so `/moderator/80110ad3/...` 404'd for them by design (PR #94's
gate). That is over — moderator access to this debate works again.

Both reverts verified: no row in `listening.debate_speakers` has a NULL
`user_id`, and all three seats on each debate point at their original accounts.
Re-running checks 4–7 or 8–12 means re-applying the fixtures first; they are
written above exactly as applied.

### Side finding — orphaned Mux live streams

Two Mux live streams were created one second apart at this debate's start
(21:59:43Z and 21:59:44Z) and left behind. Two concurrent segment-start calls
both observed `livekit_egress_id IS NULL` and both ran the Mux bootstrap; both
then failed with LiveKit `429 resource_exhausted` ("egress minutes exceeded"),
which is the known transcode-allowance blocker, not a new fault.

The rollback path ran correctly, but `completeMuxLiveStream` calls Mux's
`complete()`, which ends a live *session* and leaves the stream *object* in
place as `idle`. The code comment claims the stream is "released rather than
orphaned"; for a stream that never received a frame, `delete()` is what
releases it. `mux_stream_id` was already NULLed, so nothing in the app could
ever find these two again.

Both were deleted by hand (HTTP 204, neither had a recorded asset). The Mux
account now holds zero live streams and zero assets. **The underlying gap is
not fixed** — every start attempt while egress is blocked leaves another, and
egress stays blocked until ~1 Dec 2026. Filed as #99.

Note for whoever picks that up: `complete()` is *correct* in
`lib/debate/teardown.ts`, where the stream really did ingest and
`findLiveStreamRecording` later reads its `recent_asset_ids`. Only the
segment-route rollback should delete.
