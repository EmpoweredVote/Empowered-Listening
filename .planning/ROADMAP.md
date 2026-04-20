# Roadmap: Empowered Listening

## Overview

Empowered Listening delivers structured civic debate infrastructure in six phases — from project foundation through speaker room, observer streaming, live transcription, audience notes, and audience voting.  Each phase delivers one complete, verifiable capability that unblocks the next.  The full arc ends when Connected and Empowered accounts can watch a live Lincoln-Douglas debate, take notes, and meaningfully vote on outcomes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Schema, service accounts, Next.js scaffold, SSO auth, and desktop gate
- [ ] **Phase 2: Speaker Room** - Full Lincoln-Douglas debate runs end-to-end with server-authoritative timers and mic control
- [ ] **Phase 3: Observer Streaming** - Anonymous observers watch the live debate via HLS with segment timeline overlay
- [ ] **Phase 4: Transcription** - Every spoken word is attributed, stored per segment, and visible in near-real-time
- [ ] **Phase 5: Notes** - Connected accounts take timestamped notes; speakers use rebuttal checklist view
- [ ] **Phase 6: Voting and Badges** - Connected and Empowered accounts vote on Last Speaker, winner, and next topic; all writes gated by tier and badge checks

## Phase Details

### Phase 1: Foundation
**Goal**: The project infrastructure is live and every downstream phase can build without re-doing plumbing
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, UX-03
**Success Criteria** (what must be TRUE):
  1. The `listening` Postgres schema exists in the shared Supabase instance with all tables and migrations applied cleanly
  2. LiveKit Cloud, Cloudflare Stream, Cloudflare R2, and Deepgram accounts are provisioned and their credentials are in the environment
  3. `listening.empowered.vote` serves a Next.js 14 page deployed from Cloudflare Pages
  4. A user redirected from `accounts.empowered.vote` arrives with a verified ES256 JWT and has their `account_standing` checked before any civic write
  5. A visitor who tries to join as a speaker or moderator from a mobile device sees an "Open this on desktop" message and cannot proceed
**Plans**: TBD

Plans:
- [ ] 01-01: Database migrations (listening schema, all tables, RLS policies)
- [ ] 01-02: Third-party service provisioning (LiveKit, Cloudflare Stream/R2, Deepgram credentials)
- [ ] 01-03: Next.js 14 scaffold, Cloudflare Pages deploy, domain configuration
- [ ] 01-04: SSO auth integration (JWKS verification, account_standing check, desktop-only gate)

### Phase 2: Speaker Room
**Goal**: Two speakers and a moderator can run a full Lincoln-Douglas debate from start to finish with server-enforced timing and mic control
**Depends on**: Phase 1
**Requirements**: DEBATE-01, DEBATE-02, DEBATE-03, DEBATE-04, DEBATE-05, DEBATE-06, DEBATE-07, DEBATE-08, UX-04
**Success Criteria** (what must be TRUE):
  1. A moderator can create a debate record, mint LiveKit tokens, and share join links with speakers
  2. Two speakers and a moderator can join a LiveKit room and hear and see each other in real time
  3. The moderator can start and end segments from the desktop moderator UI; the server auto-advances through all 7 Lincoln-Douglas segments in the correct order and with correct durations
  4. The segment timer shows the correct 4-state visual (normal / warning / red_mode / expired) across all connected clients with under 200ms variance
  5. Each speaker's 60-second bonus pool activates automatically when allocated time expires; the mic is auto-muted when the pool reaches zero
  6. LiveKit track permissions enforce that only the active speaker's mic is unmuted each segment (both open during CX); timer color states render identically across all surfaces
**Plans**: TBD

Plans:
- [ ] 02-01: Debate creation, LiveKit room and JWT minting, moderator UI scaffold
- [ ] 02-02: Speaker room join flow, LiveKit participant connection
- [ ] 02-03: Lincoln-Douglas segment sequence, server-authoritative timer edge function
- [ ] 02-04: Bonus time pool logic, LiveKit track permission enforcement, auto-mute
- [ ] 02-05: Timer visual state machine, UX-04 color/icon consistency across surfaces

### Phase 3: Observer Streaming
**Goal**: Anonymous observers can watch the live debate via HLS with an honest delay indicator and a segment timeline overlay
**Depends on**: Phase 2
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. LiveKit Egress composites the speaker room and pushes the feed via RTMP to Cloudflare Stream; the pipeline starts automatically when a debate goes live
  2. An observer can open the debate URL in any modern browser and watch the HLS stream; Safari uses native HLS fallback without additional configuration
  3. A segment timeline overlay is visible showing the current debate phase and active speaker at all times
  4. A "Live (delayed)" indicator is always visible in the observer UI to surface the 5-10 second HLS lag honestly
  5. On desktop, the observer sees a multi-panel layout (video + resizable transcript panel + notes/Emparks panel) with keyboard shortcuts (Space, T, N, F)
  6. On mobile portrait, the observer sees full-width video with a sticky segment timeline and swipe tabs at the bottom; landscape unlocks a two-panel layout
**Plans**: TBD

Plans:
- [ ] 03-01: LiveKit Egress configuration, RTMP to Cloudflare Stream pipeline
- [ ] 03-02: HLS observer page (hls.js + Safari native fallback), "Live (delayed)" indicator
- [ ] 03-03: Segment timeline overlay component
- [ ] 03-04: Desktop multi-panel layout with keyboard shortcuts (UX-02)
- [ ] 03-05: Mobile tab layout with bottom sheets and landscape two-panel mode (UX-01)

### Phase 4: Transcription
**Goal**: Every spoken word during a debate is attributed to the correct speaker, chunked by segment, stored with a debate timestamp, full-text indexed, and visible to observers in near-real-time
**Depends on**: Phase 3
**Requirements**: TRANS-01, TRANS-02, TRANS-03, TRANS-04
**Success Criteria** (what must be TRUE):
  1. A backend worker subscribes to LiveKit audio tracks and streams audio to Deepgram; the worker starts when a debate starts and stops when it ends
  2. Transcript text appears in the observer's transcript panel within 1-3 seconds of being spoken
  3. Each transcript entry is attributed to the correct speaker, associated with the correct debate segment, stored with a `debate_time_mmss` value, and full-text indexed in Postgres
  4. After a debate completes, a moderator can edit transcript entries from the moderator UI; edited entries are flagged with `edited = true` and the editor's identity
**Plans**: TBD

Plans:
- [ ] 04-01: Backend transcription worker (LiveKit audio track subscription, Deepgram streaming API)
- [ ] 04-02: Supabase Realtime channel for transcript updates, live transcript panel component
- [ ] 04-03: Transcript storage (speaker attribution, segment chunking, debate_time_mmss, FTS index)
- [ ] 04-04: Post-debate moderator transcript correction UI

### Phase 5: Notes
**Goal**: Connected accounts can take timestamped notes during a live debate; speakers see their notes as a rebuttal checklist; all notes can be exported as PDF
**Depends on**: Phase 4
**Requirements**: NOTES-01, NOTES-02, NOTES-03, NOTES-04
**Success Criteria** (what must be TRUE):
  1. A Connected account can create a note during a live debate; the note's timestamp is automatically set to the current debate time
  2. Notes default to public; the user can toggle a note to private, and private notes are never returned via API to other users
  3. A speaker's notes view renders as a rebuttal checklist with checkboxes to mark opponent arguments as addressed
  4. A user can export all their notes for a debate as a formatted PDF
**Plans**: TBD

Plans:
- [ ] 05-01: Notes data layer (create, read, privacy toggle, auth gate for Connected accounts)
- [ ] 05-02: Note-taking UI (auto-timestamp, public/private toggle, real-time save)
- [ ] 05-03: Speaker rebuttal checklist view
- [ ] 05-04: PDF export

### Phase 6: Voting and Badges
**Goal**: Connected and Empowered accounts can vote on Last Speaker, post-debate winner, and next debate topic; all vote submissions are gated by tier, badge, standing, and geographic restrictions
**Depends on**: Phase 5
**Requirements**: VOTE-01, VOTE-02, VOTE-03, VOTE-04, VOTE-05, UX-05
**Success Criteria** (what must be TRUE):
  1. After rebuttals complete, a Last Speaker vote opens; Connected and Empowered accounts can vote on which speaker delivers a 3-minute Last Word; the winning speaker's Last Word segment is dynamically added to `debate_segments`
  2. After the final segment completes, a post-debate winner vote opens and remains open for the configured window (default 24 hours)
  3. A moderator can propose 2-4 topic options; Connected and Empowered accounts can vote during the designated window; the winner becomes the next debate topic
  4. Any vote attempt by a user who fails JWT verification, tier check, `account_standing` check, required badge check, or geographic restriction is rejected before the write reaches the database
  5. All interactive elements in the voting UI are keyboard-accessible; transcript updates use `aria-live polite`; color is never the sole signal for any state; WCAG AA contrast is met throughout
**Plans**: TBD

Plans:
- [ ] 06-01: Vote permission gating (JWT, tier, account_standing, badge, geographic restriction)
- [ ] 06-02: Last Speaker vote flow and dynamic Last Word segment creation
- [ ] 06-03: Post-debate winner vote
- [ ] 06-04: Next-topic vote (topic_proposals, moderator UI, voting window)
- [ ] 06-05: Accessibility audit (keyboard nav, aria-live, WCAG AA contrast, UX-05)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/4 | Not started | - |
| 2. Speaker Room | 0/5 | Not started | - |
| 3. Observer Streaming | 0/5 | Not started | - |
| 4. Transcription | 0/4 | Not started | - |
| 5. Notes | 0/4 | Not started | - |
| 6. Voting and Badges | 0/5 | Not started | - |
