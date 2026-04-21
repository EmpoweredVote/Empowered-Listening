# Phase 2: Speaker Room - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Two speakers and a moderator can run a full Lincoln-Douglas debate from start to finish with server-enforced timing and mic control. This covers debate creation, LiveKit room setup, the waiting room, all 7 LD segments with server-authoritative timers, prep time pools, bonus grace time, and mic permission enforcement. Observer streaming, transcription, and Last Word voting are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Lincoln-Douglas Segment Schedule

Standard competitive LD format — 7 segments, 32 minutes of speaking total:

| # | Segment | Active Speaker | Duration |
|---|---------|----------------|----------|
| 1 | Affirmative Constructive (AC) | Affirmative | 6 min |
| 2 | Cross-Examination | Negative questions | 3 min |
| 3 | Negative Constructive (NC) | Negative | 7 min |
| 4 | Cross-Examination | Affirmative questions | 3 min |
| 5 | First Affirmative Rebuttal (1AR) | Affirmative | 4 min |
| 6 | Negative Rebuttal (NR) | Negative | 6 min |
| 7 | Second Affirmative Rebuttal (2AR) | Affirmative | 3 min |

- Sequence is fixed — the server enforces this exact order
- Moderator can start and end segments; moderator can also repeat a segment (full timer reset, not resume)
- No skipping or re-ordering

### Prep Time Pools

- Each speaker gets a 4-minute prep time pool (standard LD format)
- Server tracks pools; pools are separate from the segment timer and from the bonus pool
- Speaker calls for prep time; the segment timer pauses while prep time is consumed
- Pool decrements in real time; server enforces the limit

### Bonus / Grace Time Pool

- A distinct 60-second pool per speaker, separate from prep time
- Activates automatically when the segment timer hits zero (not manually called)
- Mic is auto-muted when the bonus pool reaches zero
- Main timer freezes at 0:00 in expired state; bonus pool appears as a small secondary countdown alongside the frozen timer

### Moderator Role and Debate Setup

- Moderator is an Empowered account with the `listening_moderator` role (registered in 01-02)
- Debate creation form collects: topic and the two speakers' names/identifiers only
- System generates two unique speaker join URLs; moderator copies and shares them however they choose (no automated email)
- Before the debate starts: a waiting room where all participants connect to LiveKit; moderator sees connection status of each participant
- Moderator starts segment 1 when ready (no explicit "ready" confirmation required from speakers)

### Speaker Room Layout

- Three equal video tiles: Speaker A, Speaker B, Moderator — all visible to all participants
- Each tile shows: name label + mic on/off indicator only (no role label, no scores)
- Moderator gets the same video tile layout as speakers, with a separate control panel replacing the speaking cues area
- Speaker view during their active segment: large segment timer + segment name only (no mic status indicator, no prep time display in the primary view)

### Timer Visual States

- Four states: normal → warning → red_mode → expired
- Thresholds are percentage-based (scales across all 7 segment lengths):
  - **normal**: above 25% remaining
  - **warning**: 25% remaining
  - **red_mode**: 10% remaining
  - **expired**: 0:00 (timer frozen)
- Visual signal: color change only (no icons, no sound)
  - normal: neutral color
  - warning: amber
  - red_mode: red
  - expired: flashing red
- State machine must render identically across all connected clients with under 200ms variance

### Claude's Discretion

- Exact color hex values for the 4 timer states (within the neutral → amber → red → flash progression)
- Precise layout sizing and spacing of the video tiles
- Loading/connection state within the waiting room
- Error handling for participant disconnection mid-debate

</decisions>

<specifics>
## Specific Ideas

- The "45 minutes" in the design doc refers to calendar/scheduling time (including prep pools and transition buffer), not the sum of speaking segments. The system tracks 32 minutes of speaking + two 4-minute prep pools.
- Segment repeat resets to full duration — intended as a moderator safety valve for technical problems, not a routine control.

</specifics>

<deferred>
## Deferred Ideas

- Last Word segment (3-minute dynamically added segment after Last Speaker vote) — Phase 6
- Observer-visible segment timeline overlay — Phase 3
- Post-debate moderator transcript correction — Phase 4

</deferred>

---

*Phase: 02-speaker-room*
*Context gathered: 2026-04-20*
