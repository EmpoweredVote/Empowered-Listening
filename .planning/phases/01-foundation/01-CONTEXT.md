# Phase 1: Foundation - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the infrastructure every downstream phase builds on: the `listening` Postgres schema with all tables and RLS policies, third-party service credentials provisioned (LiveKit, Cloudflare Stream/R2, Deepgram), a Next.js 14 scaffold deployed to Cloudflare Pages at `listening.empowered.vote`, SSO auth via `accounts.empowered.vote`, and a desktop-only gate for speaker/moderator join paths.

Creating debates, speaker rooms, observer streaming, transcription, notes, and voting are all out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Desktop Gate (UX-03)
- Gate applies only to speaker/moderator join URLs — not the entire site
- Tone: warm and actionable (not a generic error)
- Message: short and direct — "Join as a speaker or moderator on a desktop browser" + copy-link button
- Single action: copy link to clipboard (no email-to-self in Phase 1)
- Gate is a UI response on the same page — no dedicated mobile-gate redirect URL needed

### Auth Failure Handling
- Missing or invalid JWT → redirect to `accounts.empowered.vote` with the original URL preserved as the return destination
- Valid JWT but `account_standing` blocked → show a specific message on `listening.empowered.vote` with a support link; do not redirect (user is authenticated, just restricted)
- `account_standing` message is generic: "Your account is currently restricted from participating. Contact support at [link]." — does not expose internal standing values
- JWT expiry mid-session → silent background refresh via `accounts.empowered.vote`; user should not be interrupted or kicked out during an active debate
  - **Flag for researcher:** Confirm that `accounts.empowered.vote` supports refresh tokens before implementing silent refresh

### Home Page / Entry Point
- Unauthenticated visitors see a minimal holding page: project name, one-line description, and a "Log in via Empowered" button
- After SSO completes, user lands back on the same holding page in authenticated state (account name/avatar visible)
- Return URL is preserved through SSO redirect — if a user was heading to a specific debate join URL, they arrive there after login
- Visual identity: Empowered Listening's own brand built on the EV-UI design system (`https://empoweredvote.github.io/ev-ui/`)

### Local Dev Auth
- Auth bypass flag (e.g. `AUTH_BYPASS=1`) that injects a single hardcoded mock user for local development
- Mock user has: tier = Empowered, `account_standing` = good
- Safeguard: bypass only activates when `NODE_ENV=development`; app throws a hard error at startup if bypass flag is set in any other environment
- `.env.example` committed to the repo documenting all required environment variables (service credentials, JWKS config, bypass flag) with values redacted

### Claude's Discretion
- Specific mock user UUID and display name for the dev bypass
- Exact copy for the holding page one-liner
- Header/nav structure on the holding page
- How `account_standing` is fetched and cached (every request vs. session-level)
- Compression algorithm, temp file handling, and other infra internals

</decisions>

<specifics>
## Specific Ideas

- EV-UI design system reference: `https://empoweredvote.github.io/ev-ui/` — Empowered Listening should feel like a sibling product, not a copy of accounts
- The desktop gate copy ("Join as a speaker or moderator on a desktop browser") should match the tone of the rest of EV-UI — direct, civic, not apologetic
- The auth bypass mock user should be "Chris Andrews" or a clearly fake name so it's obvious in the UI when bypass mode is active

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-20*
