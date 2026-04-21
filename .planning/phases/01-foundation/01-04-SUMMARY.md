---
phase: 01-foundation
plan: 04
subsystem: auth
tags: [jwt, jose, es256, jwks, sso, middleware, session, desktop-gate, auth-bypass]

# Dependency graph
requires:
  - phase: 01-foundation/01-03
    provides: Next.js 16.2.4 scaffold deployed to Render at listening.empowered.vote with tailwind ev-tokens, /api/health, layout.tsx, and page.tsx
provides:
  - ES256 JWKS JWT verification via jose (createRemoteJWKSet + jwtVerify, algorithms enforced)
  - Silent session renewal via GET api.empowered.vote/api/auth/session
  - account_standing gate helper (getAccountMe, isStandingActive) with React.cache() dedup
  - AUTH_BYPASS=1 dev mock user (Chris Andrews Dev Bypass, tier=empowered, standing=active)
  - assertBypassSafe() hard error guard in non-dev environments
  - Next.js middleware on /join/* — desktop gate (x-mobile-gate), bypass short-circuit, JWT verify
  - SessionProvider client context — hash token extraction, tryRenewSession, displayName state
  - LoginButton redirecting to accounts.empowered.vote/login with return URL preserved
  - DesktopGate inline component with URL display and clipboard copy-link button
  - /join/speaker/[debateId] and /join/moderator/[debateId] placeholder pages with mobile gate
  - /restricted page with support@empowered.vote link
affects: [02-rooms, 03-streaming, 04-transcription, all phases using auth]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JWKS ES256 JWT verification — jose createRemoteJWKSet, jwtVerify with algorithms: ['ES256'] enforced"
    - "Silent renewal — client-side tryRenewSession() before login redirect"
    - "React.cache() for per-request deduplication of /api/account/me fetches"
    - "Middleware desktop gate — x-mobile-gate: 1 header passed to server components via next/headers"
    - "AUTH_BYPASS pattern — isBypassActive() + assertBypassSafe() called at layout startup"

key-files:
  created:
    - lib/auth/jwks.ts
    - lib/auth/session.ts
    - lib/auth/account.ts
    - lib/auth/mockUser.ts
    - lib/auth/bypass.ts
    - middleware.ts
    - components/auth/SessionProvider.tsx
    - components/auth/LoginButton.tsx
    - components/desktop-gate/DesktopGate.tsx
    - app/join/speaker/[debateId]/page.tsx
    - app/join/moderator/[debateId]/page.tsx
    - app/restricted/page.tsx
  modified:
    - app/layout.tsx
    - app/page.tsx
    - .env.example

key-decisions:
  - "jose createRemoteJWKSet used for JWKS (not static key import); algorithms: ['ES256'] explicitly enforced to prevent algorithm confusion"
  - "middleware.ts imports verifyToken from lib/auth/jwks.ts — no next/headers, no jsonwebtoken"
  - "SessionProvider stores token in localStorage (ev_token) after hash extraction; silent renewal via cookie-based fetch"
  - "Desktop gate implemented as header pass-through (x-mobile-gate) not redirect — inline on same page per decisions"
  - "assertBypassSafe() called at module level in layout.tsx ensuring it runs at startup"

patterns-established:
  - "Auth middleware pattern: mobile gate first, bypass short-circuit second, JWT verify last"
  - "Client session pattern: hash extraction → localStorage → silent renewal → /api/account/me"
  - "Server component auth: read x-mobile-gate or x-user-id from headers() after middleware sets them"

# Metrics
duration: 6min
completed: 2026-04-21
---

# Phase 01 Plan 04: SSO Auth Summary

**ES256 JWKS JWT middleware, silent renewal, account_standing gate, desktop gate, and AUTH_BYPASS dev mode — SSO auth foundation wired against accounts.empowered.vote**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-21T03:23:23Z
- **Completed:** 2026-04-21 (verified on live deployment)
- **Tasks:** 3/3 complete (Tasks 1-2 automated; Task 3 human-verify checkpoint — APPROVED)
- **Files modified:** 15

## Accomplishments
- JWT verification library with JWKS-backed ES256 (jose), issuer/audience/algorithm all enforced
- Next.js middleware protecting /join/* routes — desktop gate, bypass, JWT verify with redirect on failure
- Client-side SessionProvider with hash token extraction, silent renewal, and /api/account/me display name
- AUTH_BYPASS dev mode with assertBypassSafe() hard error guard at layout startup
- Desktop gate UI (DesktopGate component) showing URL and clipboard copy-link button inline

## Task Commits

Each task was committed atomically:

1. **Task 1: JWT verification, silent renewal, account_standing, and dev bypass primitives** - `aac535e` (feat)
2. **Task 2: Authenticated holding page, desktop gate, join pages, and restricted page** - `3e32282` (feat)
3. **Task 3: End-to-end SSO login verification** — CHECKPOINT (human-verify, APPROVED on https://listening.empowered.vote)

## Files Created/Modified
- `lib/auth/jwks.ts` — JWKS-backed verifyToken using jose with ES256 enforced
- `lib/auth/session.ts` — tryRenewSession() via api.empowered.vote/api/auth/session
- `lib/auth/account.ts` — getAccountMe (React.cache) + isStandingActive helper
- `lib/auth/mockUser.ts` — MOCK_USER constant for AUTH_BYPASS dev mode
- `lib/auth/bypass.ts` — assertBypassSafe() + isBypassActive()
- `middleware.ts` — /join/* gate: mobile, bypass, JWT verify, redirect
- `components/auth/SessionProvider.tsx` — client session context with silent renewal
- `components/auth/LoginButton.tsx` — redirects to accounts.empowered.vote/login
- `components/desktop-gate/DesktopGate.tsx` — inline mobile gate with copy-link
- `app/layout.tsx` — SessionProvider + assertBypassSafe() at module init
- `app/page.tsx` — shows displayName or LoginButton based on session state
- `app/join/speaker/[debateId]/page.tsx` — reads x-mobile-gate, DesktopGate or placeholder
- `app/join/moderator/[debateId]/page.tsx` — same, moderator labels
- `app/restricted/page.tsx` — account restricted message with support link
- `.env.example` — AUTH_BYPASS dev block at top, SUPABASE_JWT_SECRET warning retained

## Decisions Made
- jose `createRemoteJWKSet` used with `algorithms: ['ES256']` explicitly required — prevents algorithm confusion attacks
- No `next/headers` in middleware.ts and no `jsonwebtoken` anywhere — verified by grep
- Desktop gate passes `x-mobile-gate: 1` header to server component (not a redirect) per earlier decision
- `assertBypassSafe()` called at module level in layout.tsx (runs once at module init, not per-request)
- `SessionProvider` uses localStorage for token persistence; silent renewal uses cookie credentials

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no new external service configuration required.  Existing env vars from 01-03 apply.

## Next Phase Readiness

Phase 1 is complete — all 4 plans executed and verified.

Phase 2 can build speaker/moderator UIs behind /join/* routes knowing:
- Auth is enforced at middleware for all /join/* and /debate/* routes
- account_standing helper (isStandingActive) is available for any server component that needs it
- Desktop gate is in place for speaker and moderator join pages

**Open question before Phase 2 JWT minting:** Is "moderator" a distinct Empowered role (present in JWT roles array) or an attribute on a debate record?  This must be resolved before Phase 2 mints LiveKit tokens with role-based permissions.

**Phase 1 success criteria status:**
- Criteria 1-3: Confirmed met in prior plans (01-01, 01-02, 01-03)
- Criteria 4 (ES256 JWT verified + account_standing gate): CONFIRMED MET — verified live on https://listening.empowered.vote
- Criteria 5 (mobile visitor sees "Open this on desktop" message): CONFIRMED MET — desktop gate verified live

---
*Phase: 01-foundation*
*Completed: 2026-04-21*
