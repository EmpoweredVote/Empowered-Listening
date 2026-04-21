---
phase: 01-foundation
plan: 03
subsystem: infra
tags: nextjs, render, tailwind, ev-ui, typescript

# Dependency graph
requires:
  - phase: 01-02
    provides: Render service credentials and environment variables provisioned
provides:
  - Next.js 15 app deployed to Render at listening.empowered.vote
  - EV-UI holding page with Manrope font, ev-muted-blue, ev-coral tailwind tokens
  - /api/health endpoint returning JSON (name, status, time)
  - Zod env validation via lib/env.ts
  - render.yaml infrastructure-as-code config
  - Custom domain via Route 53 CNAME to empowered-listening.onrender.com with valid TLS
affects:
  - 01-04 (auth wiring — deploy target established)
  - All future phases (Render is the production deploy target)

# Tech tracking
tech-stack:
  added:
    - Next.js 15 (App Router, Node.js runtime)
    - Tailwind CSS v4
    - Zod (env validation)
    - Render (Node.js web service hosting)
  patterns:
    - lib/env.ts — Zod-validated env accessor, fail-fast at startup
    - render.yaml — infrastructure-as-code for Render service definition
    - EV-UI tokens inlined in tailwind.config.ts (not via @empoweredvote/ev-ui preset)

key-files:
  created:
    - app/layout.tsx
    - app/page.tsx
    - app/api/health/route.ts
    - lib/env.ts
    - render.yaml
    - tailwind.config.ts
    - .env.example
    - .dev.vars.example
    - README.md
  modified:
    - package.json (Cloudflare deps removed, Render/Node.js deps retained)
    - next.config.ts
    - tsconfig.json

key-decisions:
  - "Switched from Cloudflare Workers to Render — empowered.vote DNS on AWS Route 53 is incompatible with Cloudflare Workers custom domains"
  - "Mux replaces Cloudflare Stream; AWS S3 replaces Cloudflare R2 — consistent with the Render switch"
  - "EV-UI fallback tokens used directly in tailwind.config.ts — @empoweredvote/ev-ui preset not imported"
  - "Custom domain via Route 53 CNAME (empowered-listening.onrender.com) rather than Render's auto-generated domain"

patterns-established:
  - "lib/env.ts: all process.env reads go through Zod-validated accessor — build fails on missing required vars"
  - "render.yaml: infrastracture-as-code; Render service config lives in repo, not only in dashboard"

# Metrics
duration: ~2 hours (including architecture switch and DNS/cert wait)
completed: 2026-04-21
---

# Phase 1 Plan 03: Next.js Scaffold and Render Deploy Summary

**Next.js 15 app deployed to Render at listening.empowered.vote with EV-UI holding page, /api/health endpoint, and Zod env validation**

## Performance

- **Duration:** ~2 hours (including architecture switch and DNS/cert wait ~1 hour)
- **Started:** 2026-04-20
- **Completed:** 2026-04-21
- **Tasks:** 2
- **Files modified:** ~12

## Accomplishments

- Next.js 15 app running on Render as a Node.js web service, accessible at https://listening.empowered.vote with valid TLS
- EV-UI holding page with Manrope font, ev-muted-blue (#00657C), and ev-coral (#FF5740) brand tokens applied via tailwind.config.ts
- /api/health endpoint returning `{"name":"empowered-listening","status":"ok","time":"..."}` — verified live
- Zod env validation in lib/env.ts ensures all required environment variables are present at startup
- render.yaml provides infrastructure-as-code config for the Render service

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next.js on Cloudflare Workers** - `70ac286` (feat)
2. **Task 1 (re-scaffold): Switch to Render** - `680590f` (feat — architecture deviation, see below)
3. **Task 2: Holding page, layout, health endpoint, env plumbing** - `aca0cdd` (feat)

## Files Created/Modified

- `app/layout.tsx` — Root layout with Manrope font and EV brand token body class
- `app/page.tsx` — Holding page with ev-muted-blue/ev-coral brand colors
- `app/api/health/route.ts` — Health check endpoint returning name/status/time JSON
- `lib/env.ts` — Zod-validated env accessor; process.env reads are centralised here
- `render.yaml` — Render service definition (Node.js web service, build/start commands)
- `tailwind.config.ts` — EV-UI fallback tokens (ev-muted-blue, ev-coral, Manrope)
- `.env.example` — Template for required environment variables
- `.dev.vars.example` — Template for local development overrides
- `README.md` — Project overview, setup instructions, deploy notes
- `package.json` — Cloudflare/wrangler deps removed; Next.js/Render deps retained
- `next.config.ts` — Node.js runtime target
- `tsconfig.json` — Standard Next.js TypeScript config

## Decisions Made

1. **Architecture switch: Cloudflare Workers → Render.**  The project was initially scaffolded for Cloudflare Workers (wrangler.jsonc, @cloudflare/next-on-pages).  After initial scaffold, it was discovered that empowered.vote DNS is managed on AWS Route 53 — Cloudflare Workers custom domains require proxying through Cloudflare DNS, which conflicts with the existing Route 53 setup.  Switched to Render (Node.js web service) with a Route 53 CNAME pointing to empowered-listening.onrender.com.

2. **Mux replaces Cloudflare Stream; AWS S3 replaces Cloudflare R2.**  Consistent with the Render switch — no Cloudflare infrastructure dependency remains.

3. **EV-UI fallback tokens inlined in tailwind.config.ts.**  The @empoweredvote/ev-ui preset package was not available/installed at this stage.  Brand colors (ev-muted-blue #00657C, ev-coral #FF5740) and Manrope font are defined directly in tailwind.config.ts as fallback tokens.  When the ev-ui preset becomes available, these should be replaced.

4. **Custom domain via Route 53 CNAME.**  Route 53 CNAME record listening.empowered.vote → empowered-listening.onrender.com.  TLS certificate issued by Render (~1 hour wait).

## Deviations from Plan

### Architecture Switch

**[Rule 4 - Architectural] Re-scaffold from Cloudflare Workers to Render**

- **Found during:** Task 1 (initial scaffold)
- **Issue:** empowered.vote DNS is on AWS Route 53.  Cloudflare Workers custom domains require the domain to be proxied through Cloudflare DNS — incompatible with the existing Route 53 setup.
- **Resolution:** Checkpoint returned to user; decision made to switch to Render.  wrangler.jsonc deleted; render.yaml created; next.config.ts updated to Node.js runtime target; Cloudflare-specific deps removed from package.json.
- **Files modified:** package.json, next.config.ts, tsconfig.json, render.yaml (added), wrangler.jsonc (deleted)
- **Committed in:** 680590f

---

**Total deviations:** 1 architectural (returned as checkpoint, user approved Render switch)
**Impact on plan:** The architecture switch was necessary before any deployment could proceed.  All subsequent work was on the Render target.  No scope creep.

## Issues Encountered

- **DNS/TLS wait:** After creating the Route 53 CNAME, Render's TLS certificate issuance took approximately 1 hour.  This is expected Render behavior for custom domains; no action required in future phases.
- **Cloudflare Workers incompatibility:** empowered.vote DNS on Route 53 cannot be proxied through Cloudflare without migrating DNS, which is out of scope.  Render resolves this cleanly.

## User Setup Required

The following manual steps were required (already completed):

1. **Render service creation** — Connected GitHub repo to Render dashboard, selected Node.js web service, set build/start commands from render.yaml.
2. **Route 53 CNAME** — Added CNAME record in AWS Route 53: `listening.empowered.vote` → `empowered-listening.onrender.com`.
3. **TLS certificate** — Render auto-issued TLS cert after CNAME propagated (~1 hour wait).
4. **Environment variables** — Set required env vars in Render dashboard per .env.example.

## Open Questions

- **Staging environment:** Currently only a production service exists on Render.  Before 01-04 (auth wiring), consider whether a staging environment (e.g., listening-staging.empowered.vote or the Render auto-generated URL) is needed for testing auth flows without risk to production.

## Next Phase Readiness

- Deploy target confirmed live: https://listening.empowered.vote returns holding page with valid TLS.
- /api/health returns 200 JSON — a reliable liveness check for 01-04 and all future phases.
- lib/env.ts Zod validator is in place; 01-04 adds JWT/auth env vars here without any new infrastructure.
- render.yaml committed — future deploys are automatic on push to master.
- No blockers for 01-04 (SSO auth wiring).

---
*Phase: 01-foundation*
*Completed: 2026-04-21*
