# Empowered Listening

## What This Is

Empowered Listening is structured civic debate infrastructure for Empowered Vote's Connect Pillar.  It hosts real-time debates in Lincoln-Douglas format — with server-authoritative turn management, live transcription, observer HLS streaming, and audience participation (notes, voting) — and produces permanent searchable transcripts as civic record.  It deploys to `listening.empowered.vote` and integrates directly with the main Empowered Vote Supabase instance and account system.

## Core Value

Two speakers and a moderator can run a fair, accountable structured debate that any connected observer can watch live, with a permanent and searchable transcript produced automatically.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Speaker room: two speakers and a moderator can join a LiveKit room and run a full Lincoln-Douglas debate
- [ ] Server-authoritative turn management: segment timers enforced server-side, mic permissions enforced via LiveKit track API
- [ ] Bonus time pool: each speaker has 60s shared across all their segments; auto-mute on exhaustion
- [ ] Observer HLS stream: LiveKit Egress composites speaker room to Cloudflare Stream; observers watch via HLS with "Live (delayed)" indicator
- [ ] Real-time transcription: Deepgram produces live transcript attributed to speakers, stored per-segment, subscriber-visible via Supabase Realtime
- [ ] Two-tier notes: public (shareable) and private (never shared); auto-timestamped to debate time; speaker rebuttal checklist view
- [ ] Voting: Last Speaker vote (audience picks who gets 3-min Last Word), post-debate winner vote, next-topic vote; all gated by Connected/Empowered tier + badge check
- [ ] Badge and tier permission gating: all civic writes check account_standing and tier via EV Accounts API
- [ ] Responsive observer experience: mobile tab layout (portrait) and desktop multi-panel layout as first-class experiences; speaker/moderator UI desktop-only

### Out of Scope

- CX "Question Addressed" mechanic (wrap-up countdown + bonus time transfer) — Phase 6, future milestone
- Fallacy flagging — Phase 7, future milestone
- Summary Check — Phase 8, future milestone
- Emparks and replay — Phase 9, future milestone
- Symposium format (3+ speakers) — Phase 10, future milestone

## Context

- **Empowered Vote platform**: Three-pillar civic platform (Inform / Connect / Empower).  Empowered Listening lives in Connect.  Shared Supabase instance: `kxsdzaojfaibhuzmclfq`.  Auth flows through `accounts.empowered.vote` SSO — users never log in directly at the Listening URL.
- **Account tiers**: Inform (no record) / Connected (`connect.connected_profiles`) / Empowered (`empower.empowered_profiles`).  Tier = presence of child record, never a status flag.  Always check `account_standing` before any civic write — suspended users retain valid JWTs.
- **PostgREST limitation**: PostgREST only exposes public schema.  All writes to the `listening` schema use `pool.query()` or SECURITY DEFINER RPCs.  Edge functions use the Postgres client directly.
- **Gems and XP**: Listening awards blue gems (Connect-pillar currency) and XP via server-to-server calls to the central Accounts API (`/api/gems/award`, `/api/xp/award`).  No local ledger tables.
- **JWT verification**: ES256 asymmetric via JWKS.  Never set `SUPABASE_JWT_SECRET`.
- **Third-party services**: All starting from scratch — LiveKit Cloud, Cloudflare Stream, Cloudflare R2, Deepgram accounts must be created as part of the build.
- **Pilot context**: Bloomington, Indiana (Monroe County).  IU students are the expected early adopter cohort.  Manually curated debate content for pilot.
- **Memory over moderation**: Debates are civic record, retained indefinitely.
- **No timeline pressure**: Ship when it's right.

## Constraints

- **Auth**: SSO only via `accounts.empowered.vote` — no building custom auth
- **Database**: Shared EV Supabase instance (`kxsdzaojfaibhuzmclfq`), new `listening` schema — no touching `public`, `connect`, `empower`, or `inform` schemas
- **No closed SDKs**: No Google Meet, Zoom, or similar — full control over UI and pipeline required
- **Speaker/moderator UI**: Desktop-only in v1 — mobile attempts rejected with clean guidance
- **Tech stack**: Next.js 14 App Router + TypeScript, LiveKit Cloud, Cloudflare Stream + R2, Deepgram, Supabase, Tailwind + shadcn/ui
- **Hosting**: Cloudflare Pages (pairs with Stream and R2 already being Cloudflare)
- **No pay-to-win**: Blue gems awarded only via server-to-server calls; never from client-side code
- **Two spaces after periods** in all prose (Chris's preference)
- **No em dashes** in user-facing text

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LiveKit for WebRTC | Open-source SFU, clean JWT auth integration with Supabase, cloud or self-host | — Pending |
| LiveKit Cloud (not self-hosted) | Faster setup, free tier covers early pilots; self-hosting adds ops overhead | — Pending |
| Cloudflare Stream for HLS | Cheap at scale, 5-10s delay acceptable for observers | — Pending |
| Cloudflare R2 for recordings | No egress fees, S3-compatible | — Pending |
| Deepgram for transcription | Real-time accuracy, speaker diarization; A/B test vs AssemblyAI on real audio before committing | — Pending |
| Cloudflare Pages for hosting | Pairs with Stream and R2; natural fit | — Pending |
| Server-authoritative timers | Clients render, never enforce; variance target under 200ms across clients | — Pending |
| Schema name `listening` | Onboarding doc (2026-04-19) is authoritative over Feb architecture doc | ✓ Good |
| Scope: Phases 1-5 | Core debate loop + observer + transcription + notes + voting; validate before building complexity | — Pending |

---
*Last updated: 2026-04-19 after initialization*
