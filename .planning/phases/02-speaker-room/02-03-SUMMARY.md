---
phase: "02"
plan: "03"
subsystem: debate-creation
tags: [moderator, auth-gate, transaction, api-route, form, share-page]

dependency-graph:
  requires:
    - "02-01"  # LD_SEGMENTS, debate_segments segment_type values
    - "02-02"  # pool/getPool established, JWT verify via verifyToken
  provides:
    - requireModerator / requireModeratorFromRequest auth gate
    - createDebate atomic transaction (1 debate + 3 speakers + 7 segments)
    - POST /api/debates endpoint
    - /moderator/new create-debate form
    - /moderator/[debateId]/share copy-link page
  affects:
    - "02-04"  # /join/speaker and /join/moderator routes need debate_speakers rows
    - "02-05"  # LiveKit room names follow ld-{debateId} pattern
    - "02-06"  # Moderator room uses moderatorSpeakerId
    - "02-07"  # Speaker room uses affirmativeSpeakerId / negativeSpeakerId

tech-stack:
  added:
    - zod v4 (already installed from lib/env.ts — no new install needed)
  patterns:
    - client-side role gate in CreateDebateForm (vs server middleware) — Phase 2 pattern; /moderator/* middleware added as Phase 2 follow-up
    - SECURITY DEFINER pattern deferred — raw pool transaction used for writes per project decision
    - atomic pg transaction: BEGIN / INSERT three tables / COMMIT / ROLLBACK on error

key-files:
  created:
    - lib/auth/require-moderator.ts
    - lib/debate/create.ts
    - app/api/debates/route.ts
    - app/moderator/new/page.tsx
    - app/moderator/new/CreateDebateForm.tsx
    - app/moderator/[debateId]/share/page.tsx
    - app/moderator/[debateId]/share/CopyLinkRow.tsx
  modified:
    - lib/env.ts  # added NEXT_PUBLIC_APP_ORIGIN (optional URL)

decisions:
  - id: jwt-role-claim-path
    choice: "Check both app_metadata.roles AND top-level roles claim"
    rationale: "EV platform may use either location; extractRoles() falls back from app_metadata.roles to top-level roles. Supabase standard is app_metadata.roles — that is the expected claim path for the Empowered Vote accounts JWT."
  - id: client-role-gate-pattern
    choice: "Client-side role check in CreateDebateForm useEffect (fetch /api/account/me)"
    rationale: "Server middleware for /moderator/* deferred to Phase 2 follow-up. Client-side check is sufficient for v1 since the API endpoint is protected server-side regardless."
  - id: title-topic-same-value
    choice: "title and topic set to same value in createDebate"
    rationale: "Known v1 simplification — title will be a human-friendly label in future phases; for now topic IS the title."
  - id: next-public-app-origin
    choice: "NEXT_PUBLIC_APP_ORIGIN added to lib/env.ts as optional URL"
    rationale: "Was NOT present before this plan. Added to support share-page link generation. Defaults to 'https://listening.empowered.vote' in share/page.tsx via process.env fallback."

metrics:
  duration: "~4 minutes"
  completed: "2026-04-21"
  tasks: 2/2
---

# Phase 2 Plan 03: Moderator Debate Creation Flow Summary

**One-liner:** Atomic LD debate creation (1 debate + 3 speakers + 7 segments) via authenticated POST /api/debates with moderator form at /moderator/new and copy-link share page at /moderator/[debateId]/share.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Moderator gate + createDebate + POST /api/debates | 5d4c8dd | lib/auth/require-moderator.ts, lib/debate/create.ts, app/api/debates/route.ts |
| 2 | Moderator new-debate form and share page | 94f5547 | app/moderator/new/*, app/moderator/[debateId]/share/* |

## What Was Built

### requireModerator / requireModeratorFromRequest

`lib/auth/require-moderator.ts` exports:
- `ModeratorGateError` — typed error with `status: 401 | 403` for clean API responses
- `requireModerator(token)` — verifies JWT via JWKS, checks `listening_moderator` role, returns `sub`
- `requireModeratorFromRequest(req)` — extracts Bearer token from Authorization header

Role extraction checks `app_metadata.roles` first (Supabase standard), then falls back to top-level `roles` claim.

### createDebate transaction

`lib/debate/create.ts` runs a single BEGIN/COMMIT transaction that:
1. Inserts into `listening.debates` (format='lincoln_douglas', pillar='connect', status='scheduled', livekit_room_name=`ld-{uuid}`)
2. Inserts 3 rows into `listening.debate_speakers` — affirmative (user_id=NULL), negative (user_id=NULL), moderator (user_id=moderatorUserId)
3. Loops over all 7 `LD_SEGMENTS`, inserting into `listening.debate_segments` with speaker_id mapped from activeSpeakerRole ('both' maps to NULL)

Returns `{ debateId, roomName, affirmativeSpeakerId, negativeSpeakerId, moderatorSpeakerId }`.

### POST /api/debates

Zod v4 validates body (topic 3-200 chars, names 1-80 chars). Auth gate returns 401/403 before body parsing. Returns 201 with createDebate result.

### /moderator/new

Thin server page wrapping `CreateDebateForm` client component. Form displays after client-side role check (fetch account/me, verify listening_moderator role). Unauthorized users see an amber warning.

### /moderator/[debateId]/share

Server component reads `listening.debate_speakers` for the debate, generates three URLs:
- `/join/speaker/{debateId}?s={affId}` — affirmative
- `/join/speaker/{debateId}?s={negId}` — negative
- `/join/moderator/{debateId}?s={modId}` — moderator

`CopyLinkRow` client component handles clipboard copy with transient "Copied" feedback.

## Decisions Made

1. **JWT role claim path:** Both `app_metadata.roles` and top-level `roles` checked — Supabase standard uses `app_metadata.roles`, which is the expected EV platform claim path.

2. **Client-side role gate pattern:** `CreateDebateForm` checks role via `/api/account/me` on mount. The API endpoint is server-side protected regardless, so this is UX-only. Phase 2 follow-up: add Next.js middleware for `/moderator/*` routes.

3. **title = topic in v1:** `createDebate` sets both `title` and `topic` columns to `input.topic`. Known simplification — title will diverge in future phases.

4. **NEXT_PUBLIC_APP_ORIGIN added:** Was not present in `lib/env.ts` prior to this plan. Added as `z.string().url().optional()`. Share page falls back to `'https://listening.empowered.vote'` if not set.

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

Phase 2 plans 02-04 through 02-07 can proceed. The `debate_speakers` rows with correct UUIDs and `livekit_identity` values are now produced by `createDebate`, which all downstream join/room plans depend on.

**Pending follow-up (not blocking):**
- Add Next.js middleware protection for `/moderator/*` routes (currently client-side gate only)
