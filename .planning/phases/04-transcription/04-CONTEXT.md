# Phase 4: Transcription - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Every spoken word during a live debate is attributed to the correct speaker, chunked by segment, stored with a debate timestamp (debate_time_mmss), full-text indexed in Postgres, and visible to observers in near-real-time (1-3 seconds). A post-debate moderator UI allows transcript correction with full edit history preserved.

Creating posts, notes, or voting are separate phases. This phase is transcription only.

</domain>

<decisions>
## Implementation Decisions

### Transcription Provider
- Deepgram — account already provisioned in Phase 1 (01-02)
- Use Nova-2 model for real-time streaming (researcher should confirm Nova-2 vs Nova-2-meeting for multi-speaker accuracy)
- Speaker attribution via LiveKit track identity, NOT Deepgram diarization — we already know which track belongs to which speaker; this is cheaper, more reliable, and always correct
- Transcript is verbatim — filler words (um, uh, like) are preserved exactly as spoken; this is a civic debate record

### Worker Behavior
- CX segments: both speakers are on separate simultaneous tracks; transcript entries from each interleave chronologically (time order, attributed by speaker)
- Worker failure and low-confidence word handling: Claude's discretion (researcher should propose approach — likely accept gap + flag as [Transcription unavailable]; likely best-guess + [inaudible] only at very low confidence threshold)

### Live Transcript Display
- Streaming style: interim + final — show Deepgram interim results in a lighter/italic style as they arrive; replace with committed final text when Deepgram finalizes
- Segment breaks: segment header dividers between each LD segment (e.g., "Affirmative Constructive — 8:00") — debate structure is reflected in the transcript
- Scroll behavior: auto-scroll pauses when observer scrolls up; sticky "Back to live" button appears to resume following live text
- Pre-debate state: simple placeholder text ("Transcript will appear here when speakers begin") — no complex empty state needed

### Speaker Layout
- Single scrolling column — no two-column Aff/Neg split (breaks on mobile, awkward during CX)
- Each entry prefixed with: Name + Role (e.g., "John Smith · Aff") — both shown; this is a public civic record
- Color-coded speaker label only — Aff and Neg get different colors on the speaker label text; entry body text remains neutral (accessible, not distracting)
- Timestamp per entry: debate time in mm:ss format, matching the stored debate_time_mmss column

### Post-debate Editing UX
- Access: dedicated moderator review page — /moderator/debates/[id]/transcript — available only after debate completes; separate from the live observer view
- Edit interaction: inline click-to-edit — click any entry text to edit in place; Enter or click-away to save
- Edited entries display: subtle "Edited by [name]" badge below the entry (italic, not distracting) — transparent civic record
- Edit history: original Deepgram output stored in the database alongside the edited version; moderator can revert; edited = true flag + editor identity recorded per ROADMAP requirement

### Claude's Discretion
- Worker crash/disconnection recovery approach and reconnection logic
- Low-confidence word threshold and [inaudible] handling
- Deepgram model variant (Nova-2 vs Nova-2-meeting)
- Exact color values for Aff/Neg speaker label differentiation
- Loading/error states for the transcript panel
- Exact "Edited by" badge styling

</decisions>

<specifics>
## Specific Ideas

- Speaker attribution must come from LiveKit track identity, not audio diarization — this is more reliable and avoids the cost of Deepgram diarization add-on
- The civic record should be transparent: edited entries are flagged, originals are preserved, moderator identity is recorded
- Pricing confirmed acceptable: ~$0.19/debate at Deepgram Nova-2 rates; no feature gating (unlike Mux free plan); $200 free credit covers hundreds of debates

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-transcription*
*Context gathered: 2026-04-22*
