---
status: ready to run
phase: 05-notes
source: [05-UAT.md]
created: 2026-11-19
against_commit: 33f5c2d
---

# Three-person verification sitting — runbook

Everything still open in `05-UAT.md` is open for the same reason: **it needs more
than one human.** One sitting with three people in three different seats closes
all of it. This is the plan for that sitting.

Read the "Pre-flight" section before the other two are on a call. The 17 November
attempt died in its first five minutes with two people waiting, and the only
defence against that is one person proving the path alone first.

---

## 1. What this sitting is for

Six checks are open, and every one of them is blocked on people, not on code:

| Check | What it needs | Why it's still open |
|---|---|---|
| **2** | a signed-in non-participant | nobody available who wasn't in a seat |
| **5** (observer half) | same | same |
| **7** | a speaker selecting a line *as it arrives* | needs a live sitting |
| **R1** | a PDF exported from a debate recorded after `6bcd18d` | stored rows on `80110ad3` are word-level and no export can regroup them |
| **R2** | three tabs open through a whole debate | never run |
| **B1** | a segment running into bonus time | needs a live segment |

R1 is the one that matters most. PR #98 regroups transcript rows on
`speech_final` and moves `endpointing` from 10ms to 500ms, and **no unit test can
tell us whether 500ms puts the boundary where a reader expects it.** That is a
question about real speech. This sitting is the first and only evidence we will
get before deciding whether the knob is right.

---

## 2. Seats

Three humans, three seats, **and nobody holds two.**

| Seat | Person | Needs |
|---|---|---|
| Moderator | Chris | `listening_moderator` (held), desktop browser |
| Affirmative | Andrews *or* Ryan | any ev-accounts sign-in, desktop browser |
| Negative | the other one | same |
| Anonymous observer | a 4th browser window, signed out | nothing at all |
| Signed-in observer | see check 2 below | an account with no seat on this debate |

**The one-seat rule is not fussiness.** Every debate in the database today has all
three speaker rows pointing at the same account, which is why no rebuttal
checklist ever appeared during a real session: `useUserRole` takes the *first*
matching row (issue #100), the moderator row sorts first, and `NotesPanel` gates
the checklist on `userRole === 'speaker'`. Two seats on one account makes every
result order-dependent rather than wrong-but-predictable. If a seat has to be
faked, fake it with a second account, never with a second tab.

Speakers need **no special role** — `POST /api/debates/[debateId]/token` asks only
for a valid token and an unclaimed seat. Only the moderator needs the grant.

### Each speaker runs two tabs

This is the detail most likely to derail the sitting, so settle it before the
debate starts rather than during it:

- **Tab A — the speaker room**, `/join/speaker/<debateId>?s=<speakerId>`.
  Microphone, timer, the debate itself.
- **Tab B — the observer page**, `/debates/<debateId>`. This is where the
  transcript, the notes panel and the **rebuttal checklist** live. The speaker
  room does not have them.

Checks 4, 6 and 7 all happen in Tab B while the other person is speaking in Tab A.
There is no audio on the observer page right now (no Mux playback id — see §5), so
the two tabs will not echo.

---

## 3. Pre-flight — Chris, alone, ~10 minutes

Do this **before** anyone else is on the call. Every step here is a step that has
already failed once.

1. **Health.** `https://listening.empowered.vote/api/health` returns 200.
2. **Sign in and create a debate** at `/moderator/new`. If this 403s, stop — the
   moderator gate is the 17 Nov failure and nothing after it will work. (It now
   reads `public.user_roles` rather than the token, so a WorkOS sign-in is fine;
   `854fbc06` is the backup moderator if your own account is the problem.)
3. **Confirm the share screen hands you three links** at
   `/moderator/<debateId>/share`. Treat them as private — whoever opens a speaker
   link first takes that seat, permanently.
4. **Open the observer page** `/debates/<debateId>` in a signed-out window. It
   should render without video and without errors.
5. **Claim nothing.** Do not open either speaker link yourself. That is how all
   three seats ended up on one account last time.

If step 2 or 3 fails, the sitting is off and the fix is a code change, not a
retry. Say so before people clear their calendars.

---

## 4. The sitting — order of play

Budget **45 minutes**. A full Lincoln-Douglas debate is 32 speaking minutes plus
prep; you are not going to talk for 32 minutes. **The moderator ends each segment
early** with "End segment" as soon as the check for that segment is done. All
seven segments still have to be *started and ended* — the transitions are what
B1 and R2 are testing, not the talking.

### Phase A — seats and roles (covers checks 1, 3)

1. Chris sends each speaker their own link. Each opens it, signs in, lands in the
   room. Confirm in the moderator panel that both seats show as claimed.
2. Each speaker opens **Tab B**, `/debates/<debateId>`.
3. **Check 1** — each speaker sees "Rebuttal checklist" above "Other notes" in
   Tab B. *Both* speakers, not just one.
4. **Check 3** — Chris opens `/debates/<debateId>` too and sees a flat "Notes"
   list, no checklist, no "+ Rebuttal" on hover.

### Phase B — the signed-in observer (covers checks 2, 5)

This needs one signed-in account with **no seat on this debate**. Two ways,
either is fine:

- a fourth person signs in and opens `/debates/<debateId>`, or
- a speaker signs in on a second account, or
- **cheapest:** anyone signed in opens an *old* debate they have no seat on —
  `d72df79a-2bf5-400c-b134-fdb50b8d454a` works and needs no fixture. The notes
  panel behaves the same on a completed debate.

5. **Check 2** — one flat notes list. No "Rebuttal checklist" heading, no
   "+ Rebuttal" on hover.
6. **Check 5 (observer half)** — select text in a transcript line. **No popup.**
   The moderator half already passed on 18 Nov; repeat it here anyway, it costs
   ten seconds.

### Phase C — the debate (covers checks 7, R1, B1, R2)

7. Chris starts segment 1 (Affirmative Constructive). **Expect no video** — see
   §5. The transcription worker starts regardless.
8. **Affirmative talks for ~60–90 seconds in full sentences**, with natural
   pauses. Not single words, not a monologue without breath. This is the R1
   evidence: `endpointing: 500` decides where one transcript row ends and the
   next begins, and only real speech tests it.
9. **Check 7** — while the affirmative is still speaking, the **negative** selects
   text in a transcript line **in Tab B as it arrives** and adds it to the
   checklist. Expected: the note is created and there is **no 400 in the
   console.** The ❝ quote marker may be absent on a live-arriving line — that is
   correct, not a failure.
10. **Watch the transcript panel as it fills.** This is R1's real answer. Rows
    should read as sentences or clauses. If they come out as single words again,
    the grouping fix did not take and the sitting's most important result is
    already in.
11. Chris ends segment 1, starts segment 2, and so on through all seven. Each
    speaker says a sentence or two in their own segments so every segment has
    transcript rows attributed to the right seat.
12. **B1** — on **one** segment, let the clock run all the way out instead of
    ending early. Watch the timer go normal → warning → red → expired → bonus on
    **all three surfaces at once** (moderator, both speakers, observer). Looking
    for: duplicated state, a frozen timer, surfaces disagreeing. **The pool will
    not decrement** — that is issue #75, which is deliberately not in this build.
    B1 is about *render behaviour through the transition*, nothing else.
13. Chris clicks **End debate — once.** It gives no feedback at all (issue #95) so
    the instinct is to click again. Don't. Wait for the state to change.

### Phase D — the export (covers R1)

14. A speaker clicks Export in the notes panel on `/debates/<debateId>`.
15. **Open the PDF.** The question is whether it is *readable*: transcript lines
    that read as sentences, one speaker heading per utterance rather than per
    word, notes in debate-time order.
16. **Expect issue #101 to show here** — a quoted note will now quote a whole
    sentence, but it will still sort above the transcript with no `@ mm:ss`.
    That is known. Note it and move on; do not re-file it.

### Phase E — console (covers R2)

17. **R2** — check the console on all three tabs: moderator, a speaker, the
    observer. Rolled-back writes log here, so an empty console is the result.
    Do this *during* the run, not after — a reload clears it.

---

## 5. What this sitting deliberately does not test

Say these out loud at the start so nobody reports them as bugs:

- **No video, and no recording.** LiveKit's transcode allowance is spent until
  ~1 Dec 2026. The egress bootstrap will fail with `429 resource_exhausted` on
  every segment start, the observer page will show a placeholder instead of a
  player, and there will be no recording afterwards. **The debate itself runs
  normally** — WebRTC is unaffected, and the transcription worker starts whether
  egress succeeds or not. Video is a separate sitting after 1 December.
- **Bonus-pool arithmetic** — PR #75 is held out of this build on purpose. A pool
  that looks too generous is expected.
- **Server-side segment auto-expire** — PR #76 is also held out. Consequence
  below.
- **Voting and badges** — Phase 6, deferred, not built.

---

## 6. Hazards during the run

- 🔴 **The moderator's tab must stay open and reasonably focused.** Segment
  auto-expire is client-side until #76 lands. Closing or deep-backgrounding that
  tab freezes the debate for everyone.
- **Mux orphans — fixed, but check it shipped.** Until PR #105, every segment
  start created a Mux live stream, failed, and left it behind as `idle` with
  `mux_stream_id` already nulled in the database, so nothing in the app could
  find it again (issue #99). The bootstrap guard is `livekit_egress_id IS NULL`,
  which never clears while egress keeps failing, so a seven-segment debate left
  seven orphans. **Before the sitting, confirm #105 is merged and deployed.** If
  it is, there is nothing to clean up. If it is not, expect ~7 orphans and clear
  them from the Mux account afterwards.
- **"End debate" is silent** (#95). One click.
- **Speaker links are capabilities.** First opener takes the seat and there is no
  un-claiming it without a database write.
- **Desktop only** for speaker and moderator. A phone gets the inline gate.

---

## 7. Known issues — do not re-file

| # | What you'll see | Status |
|---|---|---|
| #101 | a quoted note exports with no `@ mm:ss`, above the transcript | open, fix identified |
| #100 | role resolution is first-match, not highest-role | open — the reason for the one-seat rule |
| #99 | orphaned Mux streams after each segment start | fixed in PR #105 — confirm it is deployed |
| #95 | "End debate" gives no feedback | open |
| #69 | this is B1 | being tested here |

---

## 8. After the sitting

1. Record every result in `05-UAT.md` against the check number, with the date and
   what was actually observed — not "PASS", but what you saw.
2. Check the Mux account holds no leftover live streams. With #105 deployed it
   should be empty; if it is not, the fix did not take and that is a finding.
3. Delete the test debate's leftovers if you don't want them in the record. The
   old test debates `db5b2241`, `d72df79a` and `80110ad3` still carry test notes.
4. If R1 reads badly — rows still choppy, or rows now running together across two
   speakers' turns — **`endpointing` is the knob**, and the evidence from this
   sitting is what sets it. Capture a screenshot of the transcript panel either
   way; that is the artefact that settles it.

---

## 9. What we'll still need after this, regardless of outcome

This sitting closes Phase 5. It does not make Listening ready to put in front of
people. Open, in rough order of how much they'd hurt:

- **`/moderator/*` has no middleware gate.** Every moderator API route is
  protected server-side, but the moderator *UI* gate is client-side only.
- **No server-side segment auto-expire** (#76) — a debate is hostage to one
  browser tab.
- **Bonus pool is not persisted** (#75) — it lives in memory for the life of the
  segment.
- **No cron for the egress sweep.** `sweepOrphanedEgress` runs only when a
  segment starts, so an egress that outlives its debate is only caught by the
  next debate. One ran 6h18m here once.
- **Video unverified end-to-end under load** — the pipeline was proven on
  2026-11-17, but not through a full seven-segment debate. That is the sitting
  after 1 December.
- **Phase 6 (voting and badges) is deferred**, and deliberately so — the badge
  gate has no badges behind it yet.
