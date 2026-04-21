---
phase: 01-foundation
plan: 02
subsystem: infra
tags: livekit, mux, s3, deepgram, credentials

# Dependency graph
requires: []
provides:
  - LiveKit Cloud project credentials (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  - Mux production environment credentials (MUX_TOKEN_ID, MUX_TOKEN_SECRET)
  - AWS S3 bucket and IAM credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, bucket empowered-listening-recordings, us-east-1)
  - Deepgram account credentials (DEEPGRAM_API_KEY)
  - Accounts CORS allowlist entries for listening.empowered.vote and localhost:3000
  - Role slugs listening_host and listening_moderator registered in public.roles
  - LISTENING_GEM_KEY and LISTENING_XP_KEY service keys configured on ev-accounts-api
affects:
  - all phases (every phase needs at least one credential from this plan)

# Tech tracking
tech-stack:
  added: LiveKit Cloud, Mux, AWS S3, Deepgram
  patterns: All secrets stored in password manager; pasted to .dev.vars locally; .dev.vars gitignored; .env.example documents names only

key-files:
  created:
    - .planning/phases/01-foundation/01-02-credentials-checklist.md
  modified: []

key-decisions:
  - "Switched from Cloudflare Stream/R2/Workers to Mux/S3/Render — empowered.vote DNS on AWS/GoDaddy is incompatible with Cloudflare Workers custom domains"
  - "AWS region us-east-1 chosen to match LiveKit us-east region for lowest latency on egress pipeline"

patterns-established:
  - "Credentials pattern: password manager → .dev.vars (gitignored) → Render env vars; never committed to git"

# Metrics
duration: ~90min
completed: 2026-04-20
---

# Phase 01 Plan 02: Service Provisioning Summary

**All Phase 1-6 third-party credentials provisioned: LiveKit, Mux, AWS S3, Deepgram, accounts CORS/roles/service keys**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-04-20
- **Completed:** 2026-04-20
- **Tasks:** Manual provisioning (operator-executed)
- **Files modified:** 1 created

## Accomplishments

- LiveKit Cloud project `empowered-listening` provisioned — real-time audio/video infrastructure for speaker rooms and egress
- Mux production environment provisioned — HLS delivery and recording storage for observer streaming
- AWS S3 bucket `empowered-listening-recordings` created in us-east-1 with IAM user `empowered-listening-s3` — recording and asset storage
- Deepgram account provisioned — speech-to-text transcription pipeline for Phase 4
- Accounts integration complete: CORS allowlist updated on ev-accounts-api Render, `listening_host` and `listening_moderator` role slugs inserted into `public.roles`, `LISTENING_GEM_KEY` and `LISTENING_XP_KEY` service keys configured

## Task Commits

This plan was operator-executed (manual provisioning).  No automated task commits.

1. **Credentials checklist** - `6d79106` (feat: credentials checklist — all services provisioned)

**Plan metadata:** (this commit — docs: complete service provisioning plan)

## Files Created/Modified

- `.planning/phases/01-foundation/01-02-credentials-checklist.md` — Full credentials status table with service details, architecture note, and rotation target

## Decisions Made

- **Cloudflare Stream/R2 → Mux/S3:** empowered.vote DNS is on AWS/GoDaddy, which is incompatible with Cloudflare Workers custom domains.  Switched to Mux for HLS delivery and AWS S3 for storage.  Hosting moved from Cloudflare Workers to Render.  Codebase updated in commit 680590f before this plan executed.
- **AWS region us-east-1:** Matches LiveKit us-east region, minimising latency on the LiveKit Egress → S3 recording pipeline.

## Deviations from Plan

### Architectural Change (pre-approved)

**1. [Rule 4 - Architectural] Switched from Cloudflare Stream/R2/Workers to Mux/S3/Render**

- **Found during:** Pre-plan discovery
- **Issue:** empowered.vote DNS hosted on AWS/GoDaddy — Cloudflare Workers custom domains require DNS proxied through Cloudflare, which conflicts with existing DNS setup
- **Decision:** Approved by user; codebase updated in commit 680590f before this plan ran
- **Impact:** Mux replaces Cloudflare Stream for HLS delivery; AWS S3 replaces Cloudflare R2 for storage; Render replaces Cloudflare Workers for hosting
- **Files modified:** Codebase-wide (commit 680590f)

---

**Total deviations:** 1 architectural (pre-approved by user)
**Impact on plan:** Necessary for deployment compatibility.  No scope creep — equivalent services substituted.

## Issues Encountered

None — all services provisioned successfully on first attempt.

## User Setup Required

All credentials are in the operator's password manager.  Before plan 01-03 deploy step:

1. Create `.dev.vars` in project root (gitignored)
2. Paste all credentials from password manager:
   - LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
   - MUX_TOKEN_ID, MUX_TOKEN_SECRET
   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
   - AWS_S3_BUCKET_NAME=empowered-listening-recordings, AWS_REGION=us-east-1
   - DEEPGRAM_API_KEY
   - LISTENING_XP_KEY
3. Verify `.dev.vars` is listed in `.gitignore` before any `git add`

## Next Phase Readiness

- All credentials provisioned and documented — phases 1-6 have the third-party infrastructure they need
- `.dev.vars` must be populated from password manager before the plan 01-03 Render deploy step
- IAM key rotation target: 2027-04-20 — add to calendar
- Blocker resolved: `listening_host` and `listening_moderator` role slugs are now registered; Phase 2 role-check patterns can proceed

---
*Phase: 01-foundation*
*Completed: 2026-04-20*
