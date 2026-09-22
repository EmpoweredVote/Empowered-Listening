# Requirements: Empowered Listening

**Defined:** 2026-04-19
**Core Value:** Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.

## v1 Requirements

Scope: Architecture doc Phases 1–5 (Speaker MVP → Observer Streaming → Transcription → Notes → Voting).

### Infrastructure & Auth

- [x] **INFRA-01**: `listening` schema created in shared Supabase instance (`kxsdzaojfaibhuzmclfq`) via migrations
- [x] **INFRA-02**: Third-party service accounts created and configured (LiveKit Cloud, Mux, AWS S3, Deepgram — Cloudflare Stream/R2 replaced per 01-02 decision)
- [x] **INFRA-03**: Next.js 15 project scaffolded and deployed to Render as a Node.js web service at `listening.empowered.vote` (Cloudflare Pages replaced per 01-02 decision — empowered.vote DNS is on AWS/GoDaddy)
- [x] **INFRA-04**: SSO auth integrated — users redirected to `accounts.empowered.vote/login`, JWT verified via JWKS, `account_standing` checked before every civic write (since decision 0002 `verifyToken` dispatches on the token issuer: Supabase ES256 with user id from `sub`, or WorkOS AuthKit RS256 with user id from `external_id`)

### Debate Room

- [x] **DEBATE-01**: Moderator can create a debate record and mint LiveKit JWT tokens for speakers and moderator
- [x] **DEBATE-02**: Two speakers and a moderator can join a LiveKit room and see/hear each other
- [x] **DEBATE-03**: Moderator can start and end segments from moderator UI (desktop-only)
- [x] **DEBATE-04**: Lincoln-Douglas segment sequence (7 segments with correct durations) is server-enforced and auto-advances (sequence order enforced in the `start_segment` RPC but not live-verified — E2E Step 9 skipped; server-side auto-expire not implemented, so a closed moderator tab leaves a segment active)
- [x] **DEBATE-05**: Server-authoritative segment timers with 4-state visual state machine (normal / warning / red_mode / expired); variance target under 200ms across clients (verified at Step 11)
- [x] **DEBATE-06**: Each speaker has a 60-second bonus time pool tracked in `debate_speakers.bonus_time_seconds`; activates automatically when allocated time expires; does not replenish (pool behaves correctly within a debate, but consumption does not yet call `listening.consume_bonus_time`, so it is not persisted between debates)
- [x] **DEBATE-07**: LiveKit track permissions API enforces mic mute/unmute per active speaker per segment (CX segments: both open)
- [x] **DEBATE-08**: When a speaker's bonus pool hits zero, LiveKit auto-mutes their mic

### Observer Streaming

- [x] **OBS-01**: LiveKit Egress composites the speaker room into a single feed and pushes via RTMP to Mux (code verified; live E2E test deferred pending Mux Growth plan)
- [x] **OBS-02**: Observer page delivers HLS stream via hls.js with native Safari HLS fallback
- [x] **OBS-03**: Segment timeline overlay visible to all observers showing current phase and active speaker
- [x] **OBS-04**: "Live (delayed)" indicator surfaced honestly at all times in observer UI

### Transcription

- [x] **TRANS-01**: Backend worker subscribes to LiveKit audio tracks and streams audio to Deepgram real-time API
- [x] **TRANS-02**: Live transcript panel updates in near-real-time (target: 1–3s delay) via Supabase Realtime channel
- [x] **TRANS-03**: Transcript entries attributed to correct speaker, chunked by debate segment, stored with debate_time_mmss, and full-text indexed in Postgres
- [x] **TRANS-04**: Moderators can correct transcript errors post-debate; corrections flagged with `edited = true` and editor identity

### Notes

- [x] **NOTES-01**: Connected accounts can create timestamped notes during a live debate; timestamp auto-set to current debate time
- [x] **NOTES-02**: Notes default to public (shareable, can become Emparks); private toggle makes notes visible only to the note author and never returned via API to other users
- [ ] **NOTES-03**: Speaker notes view renders as a rebuttal checklist with checkboxes to mark opponent arguments as addressed
- [x] **NOTES-04**: User can export their notes for a debate as a formatted PDF

### Voting

- [ ] **VOTE-01**: Last Speaker vote opens after rebuttals complete; Connected and Empowered accounts vote on which speaker delivers a 3-minute Last Word segment
- [ ] **VOTE-02**: After Last Speaker vote closes, a Last Word segment is created dynamically in `debate_segments` with the winning speaker's ID
- [ ] **VOTE-03**: Post-debate winner vote opens after the final segment completes and remains open for a configurable window (default 24 hours)
- [ ] **VOTE-04**: Next-topic vote: moderator proposes 2–4 topic options in `topic_proposals`; audience votes during designated window; winner becomes next debate topic
- [ ] **VOTE-05**: All vote submissions gated: valid JWT + Connected or Empowered tier + `account_standing = 'active'` + required badge check + geographic restriction (if set on debate)

### UX & Accessibility

- [x] **UX-01**: Observer mobile experience: portrait default with full-width video and sticky segment timeline; swipe tabs at bottom (Transcript, Notes, Flag); voting as thumb-reachable bottom sheets; landscape unlocks two-panel layout
- [x] **UX-02**: Observer desktop experience: multi-panel layout (primary video panel + resizable transcript panel + notes/Emparks panel); voting as dismissible modals; keyboard shortcuts (Space, T, N, F)
- [x] **UX-03**: Speaker and moderator UI is desktop-only in v1; mobile visitors see a clear "Open this on desktop" message and cannot join as speaker/moderator
- [x] **UX-04**: Timer color states (normal / warning / red_mode / expired) render with identical colors, thresholds, and iconography across all surfaces (observer, speaker, moderator)
- [ ] **UX-05**: All interactive elements keyboard-accessible on desktop; transcript updates use aria-live polite; WCAG AA contrast minimum; color is never the sole signal for timer state

## v2 Requirements

Deferred to future milestone (architecture doc Phases 6–10).

### Cross-Examination Mechanics
- **CX-01**: "Question Addressed" button triggers 5-second wrap-up countdown for examined speaker
- **CX-02**: Overage seconds deducted from examined speaker's bonus pool; same amount added to questioner's pool
- **CX-03**: CX wrap-up events logged in `cx_wrap_up_events` audit table

### Fallacy Flags
- **FLAG-01**: Connected accounts can flag statements with Fallacy Finders classification during live debate
- **FLAG-02**: Flags aggregate and display in real time; XP awarded for validated flags via central accounts API
- **FLAG-03**: Post-debate fallacy validation workflow (hybrid community + moderator review)

### Summary Check
- **SUM-01**: Summary Check triggered when 10 audience members flag the same statement
- **SUM-02**: 30-second trigger vote; if majority approves, debate pauses for steelman summaries
- **SUM-03**: Both speakers deliver 2-minute summaries of opponent's position; audience rates accuracy (0–100) and similarity (0–100)
- **SUM-04**: 70% threshold determines pass/fail; time compensation awarded to interrupted speaker

### Emparks & Replay
- **EMPARK-01**: Rate-limited Empark creation during live debate (Connected: 3/day; Empowered: 5/8/12/day by level)
- **REPLAY-01**: Full replay experience with scrubbing, phase jumping, and timestamped notes/Emparks as annotation layer

### Symposium Format
- **SYMP-01**: 3+ speakers with rotating time allocations and moderator-guided structure
- **SYMP-02**: Multi-speaker Summary Checks and multi-vote (not winner-take-all) outcomes

## Out of Scope

| Feature | Reason |
|---------|--------|
| CX "Question Addressed" mechanic | Phase 6 — validate core debate loop first |
| Fallacy flagging system | Phase 7 — requires validated debate infrastructure |
| Summary Check | Phase 8 — most complex feature; depends on fallacy flags |
| Emparks | Phase 9 — depends on validated notes system |
| Replay with annotation layer | Phase 9 — depends on recording pipeline completion |
| Symposium format (3+ speakers) | Phase 10 — extend after binary debate is proven |
| Self-hosted LiveKit | Ops overhead; start on Cloud, evaluate at scale |
| Recording redaction | Out of scope for v1; needs policy decision before v2 |
| Custom login/signup | SSO only via accounts.empowered.vote |
| Local gem/XP ledger | Central accounts API handles this |
| Mobile speaker/moderator UI | Desktop-only in v1 by design |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| UX-03 | Phase 1 | Complete |
| DEBATE-01 | Phase 2 | Complete |
| DEBATE-02 | Phase 2 | Complete |
| DEBATE-03 | Phase 2 | Complete |
| DEBATE-04 | Phase 2 | Complete |
| DEBATE-05 | Phase 2 | Complete |
| DEBATE-06 | Phase 2 | Complete |
| DEBATE-07 | Phase 2 | Complete |
| DEBATE-08 | Phase 2 | Complete |
| UX-04 | Phase 2 | Complete |
| OBS-01 | Phase 3 | Complete |
| OBS-02 | Phase 3 | Complete |
| OBS-03 | Phase 3 | Complete |
| OBS-04 | Phase 3 | Complete |
| UX-01 | Phase 3 | Complete |
| UX-02 | Phase 3 | Complete |
| TRANS-01 | Phase 4 | Complete |
| TRANS-02 | Phase 4 | Complete |
| TRANS-03 | Phase 4 | Complete |
| TRANS-04 | Phase 4 | Complete |
| NOTES-01 | Phase 5 | Complete |
| NOTES-02 | Phase 5 | Complete |
| NOTES-03 | Phase 5 | Pending |
| NOTES-04 | Phase 5 | Complete |
| VOTE-01 | Phase 6 | Pending |
| VOTE-02 | Phase 6 | Pending |
| VOTE-03 | Phase 6 | Pending |
| VOTE-04 | Phase 6 | Pending |
| VOTE-05 | Phase 6 | Pending |
| UX-05 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✓
- Complete: 27 · Pending: 7 (NOTES-03, VOTE-01 through VOTE-05, UX-05)

---
*Requirements defined: 2026-04-19*
*Last updated: 2026-09-15 — synced with ROADMAP.md: Phase 1, Phase 2 and delivered Phase 5 requirements marked Complete; INFRA-02/INFRA-03 text corrected to the Mux/S3/Render stack*
