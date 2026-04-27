# Phase 5: Notes - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Connected accounts take timestamped, private notes during a live debate. Speakers get a persistent rebuttal checklist that combines their own typed notes and transcript lines they've flagged. All notes can be exported as a PDF — full transcript with the user's notes as margin annotations.

Notes are a personal scratchpad tool, not a social layer. Public expression is handled by Emparks (separate phase). No public/private toggle needed — notes are always private to the note-taker.

</domain>

<decisions>
## Implementation Decisions

### Note Entry UX
- Input lives inside the notes panel as a sticky element at the bottom — no new layout real estate
- Opened via both: `N` keyboard shortcut (consistent with Phase 3 reserved shortcuts) AND a visible `+` / "Add note" button in the panel header
- Enter to save, Shift+Enter for newline — quick capture optimized
- After save: input clears, timestamp auto-set on save (not on typing start)
- Edit and delete both allowed after saving — edited notes get an "edited" indicator

### Notes Privacy
- Notes are always private — visible only to the note-taker
- No public/private toggle; no social feed of other observers' notes
- Notes are never visible to other observers, speakers, or moderators
- Export is the only way notes leave the user's private view (PDF they control)

### Rebuttal Checklist (Speaker View)
- Checklist is populated from two sources, unified into one list:
  1. Speaker's own manually typed notes
  2. Transcript lines the speaker flags via text selection → floating "Add to rebuttal list" button
- Checklist is always visible alongside the debate (persistent panel, not a toggle/overlay)
- Items ordered manually — speaker can drag to reorder and prioritize
- Checkbox marks each item as addressed (visual strikethrough on checked items)

### PDF Export
- Content: full debate transcript with user's notes as margin/sidebar annotations at matching timestamps
- Layout: transcript on the left, user's notes in a right-side margin column aligned by timestamp
- Metadata header: debate title, date, speaker names, moderator name, and the exporter's name
- Availability: any time — during or after the debate; mid-debate export includes transcript and notes up to that moment

### Claude's Discretion
- Exact visual styling of the notes panel and input component
- Specific "edited" indicator design for edited notes
- PDF generation library choice
- How to handle notes whose timestamps fall between transcript entries (positioning logic)

</decisions>

<specifics>
## Specific Ideas

- Notes are intentionally a "scratch pad" — speaker/observer organizing their thoughts while the opponent talks; Emparks will eventually be the public expression mechanism
- The rebuttal checklist's dual-source design (typed notes + flagged transcript lines) maps to the real debate use case: speaker hears an argument, either types a quick note about it or flags the exact words in the transcript
- A future version may include a dedicated scratchpad mode (even more freeform than structured notes) — noted as potential future direction

</specifics>

<deferred>
## Deferred Ideas

- Public notes or shared note feeds — explicitly decided against; Emparks handles public expression
- Scratchpad mode (freeform, no timestamps) — possible future version; out of scope for Phase 5
- Moderator visibility into observer notes — decided against; notes are always private to note-taker
- AI-assisted rebuttal suggestions based on transcript — future capability, not this phase

</deferred>

---

*Phase: 05-notes*
*Context gathered: 2026-04-27*
