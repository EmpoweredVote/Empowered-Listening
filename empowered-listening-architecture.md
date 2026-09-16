# Empowered Listening — Technical Architecture (v3)

**Project handoff for Claude Code**
*Empowered Vote | Connect Pillar | April 2026*

**Deployment target:** `listening.empowered.vote`

*v3 reconciled against EMPOWERED-LISTENING-ONBOARDING.md (2026-04-19): schema renamed to `listening`, local XP ledger removed, three-gem system (blue gems for Connect pillar), PostgREST limitation documented, SECURITY DEFINER RPC pattern added, SSO auth flow documented, `cx_wrap_up_events` table added, `votes` NULL constraint clarified.*

---

## 1. Project Overview

Empowered Listening is the debate infrastructure that powers structured civic discourse across the Empowered Vote platform.  It is not a destination feature.  It is a format used everywhere debates happen (Civil Civics, Equal Slices, Issues in Focus, Empowered Candidates, Empowered Bills, and Symposium).

This document is the technical handoff for building Empowered Listening as a standalone project that will integrate with the main Empowered Vote Supabase instance.  The goal is production-grade debate software that is tightly coupled to Empowered Vote's account and badge system, supports the Lincoln-Douglas debate format out of the gate, and is financially sustainable for a nonprofit with modest audience sizes.

Key non-negotiables:
- No dependency on Google Meet, Google Live Stream, Zoom, or similar closed SDKs
- Full control over the UI, turn management, and recording pipeline
- Integration with Empowered Vote's existing Supabase auth and badge system
- Observer scaling must be cheap (thousands of viewers per debate should not blow up costs)

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Real-time speaker video/audio | **LiveKit** (open-source WebRTC SFU) | Purpose-built for real-time apps, clean JWT auth integration with Supabase, self-host or use LiveKit Cloud |
| Observer streaming | **Cloudflare Stream** (HLS) | Cheap at scale, 5-10 second latency is acceptable for observers, scales to any audience size |
| Recording/egress | **LiveKit Egress** → Cloudflare R2 | Composited recordings stored cheaply, no egress fees from R2 |
| Transcription | **Deepgram** (streaming) | Real-time accuracy, speaker diarization, reasonable pricing |
| Backend/database | **Supabase** (shared with main EV instance) | Reuse existing auth, badges, account tiers.  New schema `listening` for feature separation.  All writes via `pool.query()` or SECURITY DEFINER RPCs — PostgREST does not expose non-public schemas |
| Edge functions | **Supabase Edge Functions** (Deno) | Server-authoritative timer logic, vote tallying, permission checks |
| Search | **Postgres full-text** (Phase 1), consider pgvector or typesense later | Keep dependencies minimal early |
| Frontend | **Next.js 14 + React** (App Router) | Framer is fine for marketing, but the debate player needs a real app framework |
| Hosting | **Cloudflare Pages** or **Vercel** | Cloudflare Pages pairs well with Stream and R2 already being Cloudflare |
| Styling | **Tailwind + shadcn/ui** | Matches the rest of Empowered Vote's design direction |
| State | **Zustand** for client state, **Supabase Realtime** for server state | Keeps the debate client reactive |

---

## 3. System Architecture

Three logical tiers, each with different latency and scaling profiles:

### Tier 1 — Speaker Plane (WebRTC via LiveKit)
- Speakers and moderator join a LiveKit room
- Sub-second latency, interactive
- Max ~16 participants (supports Symposium format)
- Mic mute is server-enforced via LiveKit's track permission API

### Tier 2 — Observer Plane (HLS via Cloudflare Stream)
- LiveKit Egress composites the speaker room into a single video feed
- That feed is pushed via RTMP to Cloudflare Stream
- Observers watch the HLS stream in any modern browser
- 5-10 second delay is honestly surfaced in the UI with a "Live (delayed)" indicator

### Tier 3 — Control Plane (Supabase)
- Debate state machine (segments, timers, phases)
- Voting and Summary Check tallying
- Transcript storage
- Emparks, notes, fallacy flags
- Permission checks (badges, account tiers)
- Real-time updates pushed to all clients via Supabase Realtime channels

### Data flow summary

```
Speakers ──► LiveKit Room ──► LiveKit Egress ──► Cloudflare Stream ──► Observers
                │                                                        │
                └─► Deepgram ─► Supabase ◄─── Realtime channel ──────────┘
                                  ▲
                                  │
                        Edge Functions (timers, votes, permissions)
                                  ▲
                                  │
                          Empowered Vote Auth (JWT)
```

---

## 4. Data Model

All tables live in a new Supabase schema called `listening`.

> **PostgREST limitation:** PostgREST only exposes registered (public) schemas.  `supabaseAdmin.schema('listening').from(...).insert()` **will fail**.  For all writes to the `listening` schema, use `pool.query()` or SECURITY DEFINER RPCs called via `supabaseAdmin.rpc(...)`.  Edge functions must follow the same pattern — use the Postgres client directly, not the Supabase JS client's schema helper.

### `debates`
```sql
create table listening.debates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null,
  format text not null check (format in ('lincoln_douglas', 'symposium', 'modified')),
  pillar text not null check (pillar in ('inform', 'connect', 'empower')),
  feature_context text,
  context_id uuid,
  scheduled_start timestamptz not null,
  actual_start timestamptz,
  end_time timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'completed', 'cancelled')),
  livekit_room_name text unique,
  cloudflare_stream_id text,
  recording_url text,
  transcript_url text,
  required_badges uuid[] default '{}',
  geographic_restriction uuid,
  peak_live_viewers integer default 0,
  total_unique_viewers integer default 0,
  total_replay_views integer default 0,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
```

### `debate_speakers`
```sql
create table listening.debate_speakers (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text not null check (role in ('affirmative', 'negative', 'moderator', 'panelist')),
  display_name text not null,
  credentials text,
  bonus_time_seconds integer default 60,  -- Per design doc: default pool is 60s
  confirmed_at timestamptz,
  livekit_identity text unique  -- encode as '<debate_id>:<user_id>' to scope identity per debate
);
```

### `debate_segments`
```sql
create table listening.debate_segments (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  segment_type text not null check (segment_type in (
    'opening_statement',
    'affirmative_constructive', 'negative_constructive',
    'cross_examination_by_neg', 'cross_examination_by_aff',
    'affirmative_rebuttal_1', 'negative_rebuttal', 'affirmative_rebuttal_2',
    'summary_check', 'closing', 'last_word', 'last_speaker_vote', 'audience_vote'
  )),
  speaker_id uuid references listening.debate_speakers(id),
  sequence_order integer not null,
  allocated_seconds integer not null,
  bonus_seconds_used integer default 0,
  actual_start timestamptz,
  actual_end timestamptz,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'active', 'completed', 'paused')),
  unique(debate_id, sequence_order)
);
```

### `transcript_entries`
```sql
create table listening.transcript_entries (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  segment_id uuid references listening.debate_segments(id),
  speaker_id uuid references listening.debate_speakers(id),
  spoken_at timestamptz not null,
  debate_time_mmss text not null,
  text text not null,
  confidence_score numeric(3,2),
  character_start integer,
  character_end integer,
  edited boolean default false,
  edited_at timestamptz,
  edited_by uuid references auth.users(id)
);

create index on listening.transcript_entries(debate_id, spoken_at);
create index on listening.transcript_entries
  using gin (to_tsvector('english', text));
```

### `notes`
```sql
create table listening.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  debate_id uuid references listening.debates(id) on delete cascade,
  segment_id uuid references listening.debate_segments(id),
  content text not null,
  debate_time_mmss text,
  is_private boolean default false,  -- Private notes require explicit toggle
  created_at timestamptz default now()
);
```

### `fallacy_flags`
```sql
create table listening.fallacy_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  debate_id uuid references listening.debates(id) on delete cascade,
  transcript_entry_id uuid references listening.transcript_entries(id),
  debate_time_mmss text not null,
  fallacy_type text not null check (fallacy_type in (
    'ad_hominem', 'straw_man', 'false_dichotomy', 'appeal_to_authority',
    'appeal_to_majority', 'slippery_slope', 'red_herring',
    'circular_reasoning', 'hasty_generalization', 'other'
  )),
  explanation text,
  is_live boolean default true,
  validation_status text default 'pending'
    check (validation_status in ('pending', 'validated', 'rejected')),
  validation_count integer default 0,
  xp_awarded integer default 0,
  flag_order_in_debate integer,  -- Used to calculate early-detection bonus (first 5 per fallacy)
  created_at timestamptz default now()
);
```

### `summary_checks`
One row per triggered Summary Check:
```sql
create table listening.summary_checks (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  segment_id uuid references listening.debate_segments(id),
  triggered_at timestamptz not null,
  debate_time_mmss text not null,
  triggered_by_flag_count integer not null,
  trigger_vote_yes integer default 0,
  trigger_vote_no integer default 0,
  trigger_vote_passed boolean,
  original_statement_entry_id uuid references listening.transcript_entries(id),
  first_summarizer_id uuid references listening.debate_speakers(id),
  first_summarizer_accuracy numeric(5,2),
  first_summarizer_similarity numeric(5,2),
  second_summarizer_id uuid references listening.debate_speakers(id),
  second_summarizer_accuracy numeric(5,2),
  second_summarizer_similarity numeric(5,2),
  passed boolean,
  time_compensation_seconds integer,
  completed_at timestamptz
);
```

### `votes`
Unified vote table covering all vote types:
```sql
create table listening.votes (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  voter_id uuid references auth.users(id),
  vote_type text not null check (vote_type in (
    'winner',
    'last_speaker',
    'topic_selection',
    'summary_check_trigger',
    'summary_check_accuracy',
    'summary_check_similarity'
  )),
  target_id uuid,
  vote_value text,
  segment_id uuid references listening.debate_segments(id),
  badges_held uuid[],
  created_at timestamptz default now(),
  -- Note: target_id is nullable; Postgres NULL != NULL in unique constraints, so
  -- this constraint alone does not prevent duplicate votes where target_id IS NULL.
  -- Enforce uniqueness for null-target vote types via a partial unique index:
  -- CREATE UNIQUE INDEX votes_null_target_unique ON listening.votes (debate_id, voter_id, vote_type) WHERE target_id IS NULL;
  unique(debate_id, voter_id, vote_type, target_id)
);
```

### `topic_proposals`
For Vote Type 2 (Next Topic Selection):
```sql
create table listening.topic_proposals (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  title text not null,
  description text,
  proposed_by uuid references auth.users(id),
  vote_window_start timestamptz,
  vote_window_end timestamptz,
  vote_count integer default 0,
  selected boolean default false
);
```

### `speaker_performance`
```sql
create table listening.speaker_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  debate_id uuid references listening.debates(id),
  summary_checks_faced integer default 0,
  avg_summary_check_accuracy numeric(5,2),
  avg_summary_check_similarity numeric(5,2),
  fallacy_flags_received integer default 0,
  fallacy_flags_validated integer default 0,
  audience_winner_vote_share numeric(5,2),
  won_last_word boolean,
  recorded_at timestamptz default now()
);
```

### XP Awards — Central API (no local table)

XP is managed by the central Empowered Accounts platform.  **Do not create a local `xp_awards` table.**  Award XP via server-to-server call from your backend:

```typescript
await fetch('https://api.empowered.vote/api/xp/award', {
  method: 'POST',
  headers: { 'X-Service-Key': process.env.LISTENING_XP_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: userId,
    source: 'empowered_listening_debate',   // register this slug with accounts maintainer first
    amount: xpAmount,
    idempotency_key: `listening-<event_type>-<event_id>-${userId}`,
    metadata: { debate_id: debateId, event_type: 'fallacy_flag_validated' },
  }),
});
```

Idempotency key patterns:
- `listening-fallacy-validated-<flagId>-<userId>`
- `listening-fallacy-early-<flagId>-<userId>` (first-5 bonus)
- `listening-debate-completed-<debateId>-<userId>`
- `listening-summary-check-<checkId>-<userId>`

The award response includes `level`, `total_xp`, `xp_in_level`, `xp_to_next_level` — use directly on post-debate screens without a second fetch.  Do not include PII in `metadata`.

### `cx_wrap_up_events`
Audit trail for cross-examination "wrap it up" interactions:
```sql
create table listening.cx_wrap_up_events (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references listening.debates(id) on delete cascade,
  segment_id uuid references listening.debate_segments(id),
  questioner_id uuid references listening.debate_speakers(id),
  examined_id uuid references listening.debate_speakers(id),
  button_pressed_at timestamptz not null,
  debate_time_mmss text not null,
  countdown_expired_at timestamptz,
  overage_seconds integer default 0,        -- seconds examined spoke past 5s window
  bonus_transferred integer default 0,      -- seconds moved from examined to questioner pool
  created_at timestamptz default now()
);
```

RLS policies live in `migrations/policies.sql`.  Key rules:
- Observers (authenticated or anonymous) can read `debates`, `debate_segments`, `transcript_entries`, and vote tallies
- Connected accounts can additionally insert into `notes`, `fallacy_flags`, `votes`, and read their own private notes
- Empowered accounts additionally can be referenced in `debate_speakers`
- Only moderators can update `debate_segments.status`, `debates.status`, or resolve `summary_checks`

---

## 5. Turn Management and Timers

Timers are **server-authoritative**.  Clients render countdowns for UX, but actual enforcement happens in a Supabase Edge Function triggered by explicit segment transitions.

### Segment lifecycle

1. Moderator starts a segment via the moderator UI
2. Edge function writes `actual_start` to `debate_segments` and sets `status = 'active'`
3. LiveKit track permissions are updated so only the active speaker's mic is unmuted (except during CX, where both are open)
4. A scheduled task fires at `actual_start + allocated_seconds` and transitions into bonus time with a warning
5. When the segment completes, `actual_end` is written and the next segment auto-starts

### Timer visual state machine

| State | Condition | Appearance |
|---|---|---|
| `normal` | More than 15 seconds remaining | White/neutral background, black timer text |
| `warning` | 15 to 5 seconds remaining | Light amber background |
| `red_mode` | Less than 5 seconds remaining OR bonus time in use | Coral/red background |
| `expired` | Bonus pool exhausted | Mic muted, greyed out |

Variance target: under 200ms across all clients.

### Bonus time pool

Each speaker starts with **60 seconds** (per design doc) tracked in `debate_speakers.bonus_time_seconds`.  Rules:

- Bonus time activates automatically when allocated time expires
- Pool does not replenish during the debate
- When pool hits zero, LiveKit is instructed to mute the speaker's track
- Speakers manage this strategically across all their segments

### Cross-examination "wrap it up" mechanic

The signature Empowered Listening interaction:

1. During a CX segment, both questioner and examined mics are open
2. The questioner's UI has a **"Question Addressed"** button
3. When pressed, a 5-second countdown broadcasts to the examined speaker ("Wrap up your answer")
4. After 5 seconds, if the examined speaker is still talking:
   - Every second of overage is deducted from examined's `bonus_time_seconds`
   - The same amount is **added** to the questioner's `bonus_time_seconds` (design doc example: 45s answer, button pressed, 12 more seconds, 7 seconds transferred)
5. If examined's pool hits zero, their mic auto-mutes

Audit trail lives in a dedicated `cx_wrap_up_events` table.

### Lincoln-Douglas segment config

Per design doc:

| # | Segment | Time | Active Speaker |
|---|---|---|---|
| 1 | Affirmative Constructive (AC) | 6:00 | Affirmative |
| 2 | Cross-Examination by Negative | 3:00 | Both (Negative questions) |
| 3 | Negative Constructive (NC) | 7:00 | Negative |
| 4 | Cross-Examination by Affirmative | 3:00 | Both (Affirmative questions) |
| 5 | Affirmative Rebuttal (1AR) | 4:00 | Affirmative |
| 6 | Negative Rebuttal (NR) | 6:00 | Negative |
| 7 | Affirmative Rebuttal (2AR) | 3:00 | Affirmative |

**Note:** segments sum to 32 minutes; design doc states 45 total.  The 13-minute delta likely covers moderator intros/outros, audience voting windows, Last Speaker vote, and Last Word segment.  See Section 14.

---

## 6. Summary Check

The most complex interaction in the system.

### Trigger conditions
1. During any speaking segment, Connected accounts can flag a statement as a potential strawman
2. Once **10 audience members** have flagged the same statement, a trigger vote opens
3. The vote window is **30 seconds**
4. If majority says yes, Summary Check initiates and the debate pauses
5. Can only be triggered **once per debate phase** (prevents abuse)

### Execution
1. Debate pauses.  The current segment is set to `paused`
2. Speaker who made the potential strawman goes first.  They have **2 minutes** to summarize their opponent's position as a steelman
3. Other speaker goes second, same 2 minutes, steelmans their opponent
4. After both summaries, audience rates each on two axes:
   - **Accuracy** (how accurately did they summarize the opposing position)
   - **Similarity** (how similar was it to how the opponent describes their own position)
5. Both scores normalized to 0-100

### Scoring and consequences
- **Both speakers ≥ 70% accuracy**: Summary Check passes.  Debate resumes.  Original speaker who was interrupted gets bonus time equal to the Summary Check duration added to their next segment
- **Either speaker < 70%**: Result noted in debate record.  Debate still resumes, but failure is part of the permanent record

Time used during Summary Check does **not** count against either speaker's allocated time.

### Implementation
- `summary_checks` table holds event metadata
- `votes` table holds individual audience ratings
- Edge function computes the 70% threshold when all ratings are in (or when a timeout hits)
- Time compensation is written to the interrupted speaker's next segment's `allocated_seconds`

---

## 7. Voting Mechanics

All votes are gated by:
```typescript
async function canVote(userId: string, debateId: string, voteType: string): Promise<boolean> {
  // Must be Connected or Empowered
  // Must hold any required badges from debates.required_badges
  // Must satisfy geographic_restriction if set
  // Cannot vote twice (enforced by unique constraint too)
}
```

### Vote Type 1 — Last Speaker (Audience Reward)
- **Last Speaker is a reward from the audience.**  The audience votes on whom they most want to hear make a final 3-minute statement
- Voting window opens after rebuttals
- Winner gets a 3-minute Last Word segment
- The losing speaker does **not** get a response.  The last word is the end of the debate
- Implementation: after the `last_speaker_vote` segment completes, a `last_word` segment is added to the sequence with the winner's `speaker_id` written to it

### Vote Type 2 — Next Topic Selection
- Moderator proposes 2-4 topic options (stored in `topic_proposals`)
- Audience votes during a designated window
- Winner becomes the next debate topic in a series

### Vote Type 3 — Post-Debate Winner
- Opens after the final segment completes
- Available for a configurable window (default 24 hours)
- Results cross-referenced with demographic data for Equal Slices integration

### Vote Type 4 — Summary Check Trigger
- Gated vote that opens when fallacy flag threshold is hit
- 30-second window, simple yes/no

### Vote Type 5 — Summary Check Rating
- Two ratings per speaker per Summary Check (accuracy + similarity)
- Scaled input (1-4) rendered as a percentage

---

## 8. Real-time Transcription

1. LiveKit provides an audio track for each speaker
2. A backend worker subscribes to these tracks and pipes them to Deepgram's streaming API
3. Deepgram returns transcripts tagged with speaker identity (via LiveKit metadata)
4. Final transcripts are written to `transcript_entries`
5. Clients subscribe via Supabase Realtime
6. Target delay: 1-3 seconds from speech to visible text

Post-debate, moderators can correct transcript errors.  Corrections set `edited = true` and record who made them.

Transcript is chunked by segment automatically, enabling phase-jumping:
```
[Opening Statements] [Main Arguments] [Rebuttals] [Closing]
```

---

## 9. Emparks, Notes, and Fallacy Flags

### Notes
- Two-tier: public (default, can become Emparks) and private (never shared)
- Auto-timestamped against debate time
- Organized by debate phase automatically
- For speakers, notes function as a rebuttal checklist (checkboxes to mark points addressed)
- Export-to-PDF for post-debate review

### Emparks (rate limits per design doc)

| Account tier | Daily Empark limit |
|---|---|
| Connected | 3/day |
| Empowered (by level) | 5/day, 8/day, or 12/day |

Integration point: expose `POST /api/emparks` that the main Empowered Vote Emparks system calls.  For the standalone prototype, stub with a local Emparks table, then swap to cross-schema reference once projects merge.

### Fallacy flag XP economy (per design doc)

XP is awarded via the central accounts API (see Section 4 — no local ledger table).  Listening also awards **blue gems** for Connect-pillar engagement events.  Both are server-to-server calls gated by service keys (`LISTENING_XP_KEY`, `LISTENING_GEM_KEY`).

| Event | XP | Blue Gems |
|---|---|---|
| Flag a fallacy during live debate | +10 (pending validation) | — |
| Flag validated post-debate | +25 | +5 |
| Early detection bonus (first 5 to flag) | +50 | — |
| Multiple validated flags in single debate | Streak multiplier | — |

Fallacy types: ad hominem, straw man, false dichotomy, appeal to authority, appeal to majority, slippery slope, red herring, circular reasoning, hasty generalization.

Validation happens **after** the debate ends.  Mechanism is Section 14 open question.

---

## 10. Platform Experience and Responsive Design

### Design philosophy

The alpha has latitude on aesthetics but not on platform quality.  Empowered Listening must fit beautifully on both mobile and desktop, even if the experiences diverge significantly.  Responsive is the floor.  Platform-native is the ceiling.

Claude Code should treat mobile and desktop as two first-class experiences sharing a data model and component library, not as a single layout that scales.  A debate watched on a phone during a commute and the same debate watched on a 27-inch display should both feel like they were designed for their context, not squeezed into one.

### Observer experience: desktop

Single-page, multi-panel layout.  The observer has screen real estate to watch, read, annotate, and vote simultaneously:

- **Primary panel** (largest): HLS video feed with segment timeline overlay at top
- **Secondary panel** (right side, resizable): live transcript with speaker color coding
- **Tertiary panel** (bottom or drawer): notes and Emparks
- **Voting overlays**: modal at decision moments, dismissible but persistent
- **Timer and "Live (delayed)" indicator**: always visible in a fixed header
- **Keyboard shortcuts**: space to play/pause, T to jump to transcript, N to add note, F to flag fallacy

### Observer experience: mobile

Focused single-task interface.  Video is primary.  Everything else is an accessible tab away:

- **Default portrait view**: full-width video with sticky segment timeline and timer at top
- **Swipe tabs at bottom**: Transcript, Notes, Emparks, Flag
- **Voting and Summary Check triggers**: slide up as bottom sheets, thumb-reachable
- **Transcript tab**: full-screen reading experience with auto-scroll and a "jump to live" pill
- **Notes tab**: timestamp is always the current moment.  One-tap to save
- **Flag tab**: Fallacy Finders classification rendered as a grid of large touch targets
- **Landscape mode**: unlocks a desktop-lite two-panel layout (video + transcript)

### Speaker and moderator: desktop-only in v1

Speaker UI is genuinely complex (video + opponent + notes + timer + bonus pool + CX button).  Moderator UI is operationally sensitive (start/end segments, mic control, intervention tools).  Both are desktop-only in v1.  When a user tries to join a debate as a speaker from mobile, the app should reject cleanly with "Open this on desktop" guidance rather than trying to shoehorn the experience.

### Shared primitives

Regardless of platform, certain things must feel identical:

- **Timer color states** (normal / warning / red_mode / expired) render the same everywhere
- **Speaker attribution colors** are consistent across transcript, Emparks, and video labels
- **Voting prompts** use the same language and confirmation patterns
- **"Live (delayed)" badge** appears identically

### Accessibility floor

- All interactive elements reachable by keyboard on desktop
- Screen reader support for transcript updates (aria-live polite)
- Color is never the only signal for timer states.  Iconography accompanies color
- Text meets WCAG AA contrast minimums
- Captions available in replay (transcript auto-generates these)

### Design assets

No locked-in visuals for alpha.  Claude Code should use shadcn/ui defaults with Tailwind.  When the design pass lands (from Krishna, Radhika, or external partners), the design system will be swapped in wholesale.  Structure components to make that swap painless:

- Avoid inline styles
- Centralize color tokens in a theme file
- Keep typography in a theme file
- Use CSS variables for anything a designer might want to override
- Build every component mobile-first, then enhance for desktop

### What observers see (functional summary)

- HLS video feed (via hls.js or native Safari)
- Live transcript panel (subscribed via Supabase Realtime)
- Segment timeline showing current phase and speaker
- Read-only Emparks layer
- Authenticated Connected or Empowered accounts: voting overlays at appropriate moments
- Anonymous observers: "Connect your account to vote" prompts at vote moments
- HLS delay (5-10s) surfaced honestly with a "Live (delayed)" indicator

---

## 11. Recording and Playback

1. LiveKit Egress records the composited room
2. Output pushed to Cloudflare R2 (S3-compatible, no egress fees)
3. On debate completion, a post-processing job:
   - Transcodes to HLS chunks for playback
   - Generates waveform and thumbnails per segment
   - Writes `recording_url` to `debates`
4. Replay UI uses the same player as live observers with full scrubbing and pre-loaded transcripts
5. Timestamped notes and Emparks become clickable links that seek the video

Retention: indefinite by default.  Debates are civic record.

---

## 12. Implementation Phases

### Phase 1 — Speaker MVP (2-3 weeks)
- LiveKit room creation with JWT auth via Supabase
- Basic moderator UI to start/end segments
- Hardcoded Lincoln-Douglas segment sequence
- Server-authoritative timers with visual state machine
- Bonus time pool (60s default) with auto-mute on exhaustion
- No observers, no transcription, no voting
- **Goal:** two speakers and a moderator can run a full LD debate start to finish

### Phase 2 — Observer streaming (1-2 weeks)
- LiveKit Egress → Cloudflare Stream pipeline
- HLS player in a simple observer page
- Segment timeline overlay
- **Goal:** anonymous observers can watch a live debate

### Phase 3 — Transcription (1-2 weeks)
- Deepgram integration
- Live transcript panel for speakers and observers
- Phase-based transcript chunking
- Post-debate editing for moderators
- **Goal:** every debate has a searchable, accurate transcript

### Phase 4 — Notes and speaker rebuttal tools (1-2 weeks)
- Two-tier note system (public/private)
- Auto-timestamping
- Speaker rebuttal checklist view
- Note export to PDF
- **Goal:** Connected accounts and speakers have full note functionality

### Phase 5 — Voting and badges (2 weeks)
- Badge permission checks tied to Empowered Vote auth
- Last Speaker vote (audience reward; winner gets 3-min Last Word)
- Post-debate winner vote, topic vote
- **Goal:** Connected accounts meaningfully participate

### Phase 6 — Cross-examination mechanics (1-2 weeks)
- "Question Addressed" button with 5-second countdown
- Bonus time transfer logic
- Auto-mute on pool exhaustion during CX
- **Goal:** the core Empowered Listening interaction works end-to-end

### Phase 7 — Fallacy flags (1-2 weeks)
- Live flagging with Fallacy Finders classification UI
- Flag aggregation and display during live debate
- Post-debate validation workflow (stub)
- XP economy writes to `xp_awards`
- **Goal:** audience has the fallacy flagging toolkit

### Phase 8 — Summary Check (2-3 weeks)
- 10-flag trigger threshold
- 30-second audience trigger vote
- Summary Check UI with 2-minute speaker timers
- Accuracy + similarity rating by audience
- 70% threshold evaluation
- Time compensation logic
- **Goal:** the crown-jewel accountability mechanism works

### Phase 9 — Emparks and replay (2 weeks)
- Emparks rate-limited creation during live debate
- Emparks rendered on replay as annotation layer
- Full replay experience with scrubbing and phase jumping
- **Goal:** completed debates become civic artifacts

### Phase 10 — Symposium format (later)
- 3+ speakers with rotating time
- Moderator-guided structure
- Multi-speaker Summary Checks
- Multi-vote (not winner-take-all) outcomes
- **Goal:** format extends beyond binary debates

---

## 13. CLAUDE.md Starter

Drop this in the project root when Claude Code starts working:

```markdown
# Empowered Listening

Standalone debate software for Empowered Vote.  Part of the Connect Pillar.
Deploys to listening.empowered.vote.
Will integrate with the main Empowered Vote Supabase instance.

## Architecture
- Next.js 14 App Router + React + TypeScript
- Supabase (shared EV instance, schema: `listening`) for all persistent state
- LiveKit for speaker WebRTC
- Cloudflare Stream for observer HLS
- Cloudflare R2 for recordings
- Deepgram for real-time transcription
- Tailwind + shadcn/ui for styling

## Auth
- Users never log in here.  SSO only: redirect to `accounts.empowered.vote/login?redirect=<url>`
- On return, parse `#access_token=` from URL hash.  Store as `ev_token` in localStorage
- On app load, call `GET https://api.empowered.vote/api/auth/session` with `credentials: 'include'` for silent renewal
- JWT verification: ES256 via JWKS.  Never set `SUPABASE_JWT_SECRET`
- Always check `account_standing` before any civic write.  Suspended users have valid JWTs

## Database writes
- `supabaseAdmin.schema('listening').from(...).insert()` WILL FAIL — PostgREST does not expose non-public schemas
- All `listening` schema writes use `pool.query()` or SECURITY DEFINER RPCs called via `supabaseAdmin.rpc(...)`
- Edge functions must also use the Postgres client directly for `listening` schema writes

## Key directories
- /app — Next.js routes
  - /debate/[id] — live debate viewer (speaker or observer based on auth)
  - /moderator/[id] — moderator controls
  - /replay/[id] — post-debate replay
- /components — React components (flat where possible)
- /lib
  - /livekit — LiveKit client and token minting
  - /supabase — Supabase client and typed schema
  - /realtime — Supabase realtime channel helpers
  - /permissions — badge checks, account tier gating
  - /accounts — wrappers for EV Accounts API calls (gems, XP, roles, social graph)
- /supabase
  - /migrations — SQL migrations for the `listening` schema
  - /functions — edge functions for timers, vote tallying, Summary Check resolution
- /docs — design doc and architecture reference

## Conventions
- Two spaces after periods in all prose (Chris's preference)
- No em dashes in user-facing text
- Server-authoritative for anything time-sensitive.  Clients render, they do not enforce
- All debate state transitions go through edge functions, never client-side Supabase writes
- Badge permission checks centralized in /lib/permissions
- Gem and XP awards: server-to-server only via LISTENING_GEM_KEY and LISTENING_XP_KEY env vars
- Use shadcn/ui components over custom where possible
- **Mobile and desktop are first-class experiences.**  Build mobile-first, then enhance for desktop.  Diverge layouts where the context genuinely differs (observer tab navigation on mobile vs multi-panel on desktop).  Do not ship a layout that only works on one
- No locked visuals for alpha.  Centralize color and typography tokens in theme files so a designer can swap them wholesale later
- Speakers and moderators are desktop-only in v1.  Reject mobile attempts with clean guidance

## What not to build (already exists in accounts platform)
- Login / signup — use SSO
- JWT verification from scratch — copy from accounts `backend/src/middleware/auth.ts`
- Gem ledger — call `POST https://api.empowered.vote/api/gems/award` (blue gems for Connect engagement)
- XP ledger — call `POST https://api.empowered.vote/api/xp/award`
- Follow/peer system — use `/api/social/*`
- Role/permission system — use `/api/roles/check`
- Admin user management — use `/api/admin/accounts/*`

## What not to touch
- /lib/auth — uses the same JWT format as the main Empowered Vote platform.  Do not change the token shape
- The debate_segments.sequence_order integers are load-bearing.  Do not renumber
- Summary Check thresholds (10 flags, 30s vote window, 70% pass) are specified in the design doc; do not change without approval
- Last Speaker is an audience reward, not a competitive exchange.  The winner gets a 3-minute Last Word; the loser does not get a response

## Not yet built / open questions
- See /docs/architecture.md section 14
```

---

## 14. Open Questions

1. **Lincoln-Douglas total time (32 vs 45 minutes).**  Design doc states 45 minutes total, but listed segments sum to 32.  The 13-minute delta likely covers moderator intros/outros, audience voting windows, Last Speaker vote window, and the Last Word segment.  Needs a definitive segment-by-segment schedule including non-speaking segments

2. **Fallacy validation mechanism.**  Post-debate validation is specified but not the mechanism.  Options: community vote (susceptible to brigading), moderator review (slow), or hybrid.  Recommend hybrid: community-voted flags reviewed by moderator for final validation

3. **Self-host LiveKit or use LiveKit Cloud?**  Cloud is faster to set up and the free tier covers early pilots.  Self-hosting saves money at scale but adds ops overhead.  Recommend starting on Cloud

4. **Transcription provider.**  Deepgram is the current pick.  AssemblyAI and Whisper-based options are competitive.  A/B test on actual debate audio before committing

5. **Moderator tier.**  Is "moderator" a new role distinct from Empowered, or an attribute on an Empowered account?

6. **Symposium format segments.**  Design doc describes the concept but not segment timings.  Punt to Phase 10

7. **Mobile observer performance.**  The mobile tab-based layout needs real testing on low-end Android devices and older iPhones.  Speakers and moderators are committed to desktop-only in v1, so mobile performance only matters for the observer experience

8. **Recording redaction policy.**  Eventually speakers may want to redact moments (misspoke, accidentally shared PII).  Out of scope for v1 but needs an answer before v2

9. **Empark default visibility.**  Design doc implies public-by-default with subscription-based reach.  Confirm before Phase 9

10. **Visual design system.**  Alpha uses shadcn/ui defaults.  When the permanent design pass lands, it swaps in wholesale.  Until then, mobile and desktop should both look clean and intentional, not "unfinished"

11. **Cost ceiling per debate.**  Need a hard cap to prevent a viral debate from racking up a surprise bill.  Monitor LiveKit participant-minutes and Cloudflare Stream delivery-minutes with alerts at defined thresholds

12. **Anonymous observer rate limiting.**  A single debate could be hit by bots.  Need basic rate limiting on the HLS edge before launch

13. **Summary Check scoring input granularity.**  Design doc shows a 1-4 radio scale for both accuracy and similarity.  Confirm the mapping and how the 70% threshold is calculated from discrete inputs

---

## 15. What Claude Code should do first

1. Read this document end to end, plus the design doc in `/docs/empowered-listening-design.md`
2. Initialize a Next.js 14 project with Tailwind and shadcn/ui
3. Set up the Supabase migration scaffolding and write migrations for all tables in Section 4
4. Stub out the `/lib` directories with empty files and type definitions
5. Build a minimal LiveKit token-minting edge function and a test page that can join a room
6. Report back before moving to Phase 1 implementation

---

*This architecture doc is a companion to the Empowered Listening design doc.  The design doc defines what we are building and why.  This doc defines how.  When they conflict, raise it for resolution rather than picking one.*
