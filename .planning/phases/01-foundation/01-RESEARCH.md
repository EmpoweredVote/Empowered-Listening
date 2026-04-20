# Phase 01: Foundation - Research

**Researched:** 2026-04-20
**Domain:** Next.js 15 / Cloudflare Workers / Supabase schema / SSO auth / EV-UI design system
**Confidence:** HIGH overall (primary sources verified)

---

## Summary

Phase 1 provisions four independent building blocks that every downstream phase depends on: the `listening` Postgres schema in the shared Supabase instance, third-party service credentials, a deployed Next.js scaffold on Cloudflare, and SSO auth wired to `accounts.empowered.vote`.

**Critical deployment finding:** The locked tech stack specifies "Cloudflare Pages" but Cloudflare has shifted its recommended Next.js deployment to Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`). The `@cloudflare/next-on-pages` adapter (original Pages approach) is now deprecated and only supports Edge runtime, which lacks many App Router features.  The correct implementation is Cloudflare Workers with OpenNext -- which still uses the Cloudflare dashboard under "Pages & Workers" and still supports the `listening.empowered.vote` custom domain.  Additionally, Next.js 14 support was dropped by OpenNext in Q1 2026; the scaffold must use **Next.js 15** (or 16) instead.

**Deployment recommendation:** Use `@opennextjs/cloudflare` with Next.js 15, deployed as a Cloudflare Worker.  The domain setup (`listening.empowered.vote`) remains identical regardless of Pages vs Workers.

**Primary recommendation:** Scaffold Next.js 15 with `@opennextjs/cloudflare`, copy `requireAuth` middleware verbatim from the accounts repo, use `pool.query()` for all `listening` schema writes, and consume `@empoweredvote/ev-ui` tokens via its Tailwind preset for brand consistency.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 15.x (latest minor) | App Router framework | 14 dropped by OpenNext Q1 2026; 15 is current supported target |
| @opennextjs/cloudflare | latest | Build/deploy adapter for Cloudflare Workers | Replaces deprecated `next-on-pages`; full App Router support |
| wrangler | >=3.99.0 | Cloudflare CLI for local preview and deploy | Required by OpenNext adapter |
| typescript | 5.x | Type safety | Locked project constraint |
| tailwindcss | 4.x (or 3.x via shadcn init) | Utility CSS | Locked project constraint |
| shadcn/ui | latest | Component scaffolding | Locked project constraint |
| @empoweredvote/ev-ui | npm latest | EV brand design tokens + components | Locked; provides Tailwind preset, color scale, typography |
| jose | 6.x | ES256 JWT verification via JWKS | Onboarding doc §2.3 specifies `jose`; works in Workers runtime; NOT `jsonwebtoken` |
| pg (node-postgres) | >=8.16.3 | Direct Postgres pool for `listening` schema writes | Required; PostgREST does not expose non-public schemas |
| @supabase/supabase-js | 2.x | Supabase admin client (service role, RPCs) | For SECURITY DEFINER RPC calls and admin operations |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| supabase CLI | latest | Database migrations against remote instance | Phase 1 schema setup; `supabase db push` deploys migration files |
| zod | 3.x | Runtime schema validation | Validate env vars, API responses, JWT payload shape |
| @types/pg | latest | TypeScript types for pg | Always alongside pg |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@opennextjs/cloudflare` | Vercel hosting | Cloudflare is locked; Vercel would require DNS/domain change |
| `@opennextjs/cloudflare` | `@cloudflare/next-on-pages` | next-on-pages is deprecated; Edge-only; not viable |
| `jose` | `jsonwebtoken` | jsonwebtoken uses Node crypto; breaks in Workers runtime; onboarding doc explicitly prohibits it |
| `pg` direct pool | Supabase JS client `.schema('listening')` | Supabase JS client uses PostgREST which rejects non-public schemas; confirmed in onboarding doc §4 |
| Next.js 15 | Next.js 14 | 14 support dropped Q1 2026 in OpenNext; new project should start on 15 |

**Installation:**
```bash
# Create app (Next.js 15 + Cloudflare)
npm create cloudflare@latest -- empowered-listening --framework=next --platform=workers

# Then add supporting packages
npm install jose pg @supabase/supabase-js zod @empoweredvote/ev-ui
npm install --save-dev @types/pg supabase wrangler@latest

# Init shadcn/ui
pnpm dlx shadcn@latest init -t next
```

---

## Architecture Patterns

### Recommended Project Structure

```
empowered-listening/
├── app/
│   ├── layout.tsx           # Root layout; auth context, EV-UI token import
│   ├── page.tsx             # Holding page (unauthenticated + authenticated states)
│   ├── middleware.ts        # JWT verification, mobile gate, standing check
│   └── api/
│       └── health/
│           └── route.ts     # GET /api/health (platform convention)
├── lib/
│   ├── auth/
│   │   ├── requireAuth.ts   # Copied from accounts repo — do not rewrite
│   │   ├── getSession.ts    # Silent renewal via /api/auth/session
│   │   └── mockUser.ts      # Dev bypass user (only when NODE_ENV=development)
│   ├── db/
│   │   ├── pool.ts          # pg Pool configured for Supabase transaction pooler
│   │   └── queries.ts       # Typed wrappers around pool.query() for listening schema
│   └── supabase/
│       └── admin.ts         # supabaseAdmin with service_role (server only)
├── components/
│   ├── desktop-gate/
│   │   └── DesktopGate.tsx  # Mobile gate UI (warm copy, copy-link button)
│   └── ui/                  # shadcn components (auto-generated)
├── supabase/
│   └── migrations/
│       └── 20260420000000_create_listening_schema.sql
├── wrangler.jsonc           # Cloudflare Workers config
├── open-next.config.ts      # OpenNext adapter config
├── .env.example             # All env vars, values redacted — committed
├── .dev.vars                # Local secrets (gitignored)
└── cloudflare-env.d.ts      # Generated by `wrangler types`
```

### Pattern 1: JWT Verification Middleware (middleware.ts)

**What:** Verify the ES256 JWT on every protected request before it hits route handlers or Server Components.  Forward verified user ID via header so downstream doesn't re-verify.
**When to use:** All paths under `/join/` (speaker/moderator join URLs) and any future authenticated pages.

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §2.3 + Next.js middleware docs
// Source: https://nextjs.org/docs/app/api-reference/functions/userAgent
import { NextRequest, NextResponse, userAgent } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json')
);

const MOBILE_JOIN_PATHS = /^\/join\/(speaker|moderator)/;

export async function middleware(request: NextRequest) {
  const { device } = userAgent(request);
  const isMobile = device.type === 'mobile' || device.type === 'tablet';

  // Desktop gate: applies only to speaker/moderator join paths
  if (MOBILE_JOIN_PATHS.test(request.nextUrl.pathname) && isMobile) {
    // Render gate on same page — pass header to signal gate state
    const response = NextResponse.next();
    response.headers.set('x-mobile-gate', '1');
    return response;
  }

  const token = request.cookies.get('ev_token')?.value
    ?? request.headers.get('authorization')?.slice(7);

  if (!token) {
    const returnUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      `https://accounts.empowered.vote/login?redirect=${returnUrl}`
    );
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1',
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    const response = NextResponse.next({
      request: { headers: new Headers(request.headers) },
    });
    response.headers.set('x-user-id', payload.sub as string);
    return response;
  } catch {
    const returnUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      `https://accounts.empowered.vote/login?redirect=${returnUrl}`
    );
  }
}

export const config = {
  matcher: ['/join/:path*', '/dashboard/:path*'],
};
```

**Important Cloudflare note:** In middleware running on Workers, use `request.cookies.get(...)` NOT `cookies()` from `next/headers`.  The `cookies()` API from `next/headers` is Node.js-only and breaks in Workers.

### Pattern 2: Direct Postgres Pool for `listening` Schema

**What:** Use `pg` Pool with Supabase's transaction pooler connection string for all writes to the `listening` schema.  PostgREST does not expose non-public schemas.

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §4 "Non-Public Schema Writes"
import { Pool } from 'pg';

// Use transaction pooler (port 6543) for serverless; not direct connection
export const pool = new Pool({
  connectionString: process.env.DATABASE_TRANSACTION_POOLER_URL,
  // Transaction mode does not support prepared statements
  // pg handles this automatically with connectionString param
  max: 5,
});

// Example usage — always schema-prefix table names
export async function insertDebate(title: string, createdBy: string) {
  const { rows } = await pool.query(
    `INSERT INTO listening.debates (title, created_by)
     VALUES ($1, $2)
     RETURNING *`,
    [title, createdBy]
  );
  return rows[0];
}
```

**Connection string format:**  Use `DATABASE_TRANSACTION_POOLER_URL` (port 6543, transaction mode) — not the direct connection (port 5432) or session pooler.  Transaction mode is required for serverless/Workers environments.

### Pattern 3: Auth Bypass for Local Dev

**What:** Inject a hardcoded mock user when `AUTH_BYPASS=1` AND `NODE_ENV=development`.  Hard error in any other environment.

```typescript
// Source: Phase 1 CONTEXT.md Decisions — Local Dev Auth
// lib/auth/mockUser.ts

export const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  display_name: 'Dev Bypass User',
  tier: 'empowered' as const,
  account_standing: 'active' as const,
};

export function assertBypassSafe(): void {
  if (process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'AUTH_BYPASS is set in a non-development environment. ' +
      'This is a critical security misconfiguration. Refusing to start.'
    );
  }
}
```

Call `assertBypassSafe()` at application startup (e.g., in the root layout or a startup check file).  The mock user UUID is arbitrary but must be obviously fake in the UI.

### Pattern 4: Supabase Migration for Custom Schema

**What:** SQL migration file that creates the `listening` schema with tables, RLS enabled, and FK references to `public.users`.

```sql
-- Source: EMPOWERED-LISTENING-ONBOARDING.md §4 "Your Own Schema"
-- File: supabase/migrations/20260420000000_create_listening_schema.sql

CREATE SCHEMA IF NOT EXISTS listening;

-- All user FKs reference public.users(id) — not auth.users directly
CREATE TABLE listening.debates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'upcoming',
  created_by  UUID NOT NULL REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE listening.debates ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- Read policy: debates are public once live or archived.
CREATE POLICY "public read active debates"
  ON listening.debates
  FOR SELECT
  TO authenticated, anon
  USING (status IN ('live', 'archived'));
```

Deploy with: `supabase db push --linked`

**RLS syntax is identical for non-public schemas** -- just prefix the table with the schema name in `ALTER TABLE` and `CREATE POLICY`.

### Pattern 5: Silent Session Renewal

**What:** On app load, attempt silent renewal before showing a login prompt.  Uses the `ev_session` httpOnly cookie set at login.

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §2.2 "Silent Session Renewal"
// lib/auth/getSession.ts

export async function tryRenewSession(): Promise<string | null> {
  try {
    const res = await fetch('https://api.empowered.vote/api/auth/session', {
      credentials: 'include', // Required for ev_session cross-origin cookie
    });
    if (!res.ok) return null;
    const { access_token } = await res.json();
    return access_token;
  } catch {
    return null;
  }
}
```

**Confirmed:** `accounts.empowered.vote` supports silent renewal via `GET /api/auth/session` + `ev_session` httpOnly cookie.  This is documented in the onboarding guide and directly answers the open question from CONTEXT.md.

### Pattern 6: Desktop Gate UI Component

**What:** Inline UI response on the same page when mobile device hits a speaker/moderator join path.  No redirect.

```typescript
// Source: Phase 1 CONTEXT.md Decisions — Desktop Gate
// components/desktop-gate/DesktopGate.tsx
'use client';

interface DesktopGateProps {
  joinUrl: string;
}

export function DesktopGate({ joinUrl }: DesktopGateProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(joinUrl);
  };

  return (
    <div role="alert" aria-live="polite">
      <p>Join as a speaker or moderator on a desktop browser.</p>
      <button onClick={handleCopy} type="button">
        Copy link
      </button>
    </div>
  );
}
```

Detection is in `middleware.ts` via Next.js built-in `userAgent()`.  `device.type` returns `'mobile'` or `'tablet'` for mobile devices; `undefined` for desktop.

### Pattern 7: EV-UI Design Tokens in Tailwind

**What:** Import the EV-UI Tailwind preset so all color tokens, typography, and spacing match the platform design system.

```typescript
// Source: github.com/empoweredvote/ev-ui (README)
// tailwind.config.ts
import evUIPreset from '@empoweredvote/ev-ui/tailwind-preset';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [evUIPreset],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
};
export default config;
```

Key brand tokens from `ev-ui/src/tokens.js`:
- Primary font: **Manrope** (weights 400–800)
- Brand coral: `#FF5740` (ev-coral)
- Muted teal: `#00657C` (ev-muted-blue, Listening primary)
- Light blue: `#59B0C4` (ev-light-blue)
- Yellow: `#FED12E` (ev-yellow, Inform tier)
- 4px spacing scale (0, 2, 4, 6, 8, 12, 16, ...)
- Breakpoints: sm 640, md 768, lg 1024, xl 1280

### Pattern 8: wrangler.jsonc Configuration

**What:** Required Cloudflare Workers config for the OpenNext adapter.

```jsonc
// Source: https://opennext.js.org/cloudflare/get-started
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "empowered-listening",
  "compatibility_date": "2024-12-30",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "services": [{
    "binding": "WORKER_SELF_REFERENCE",
    "service": "empowered-listening"
  }]
}
```

### Anti-Patterns to Avoid

- **Using PostgREST for `listening` schema writes:** `supabaseAdmin.schema('listening').from('...').insert()` silently fails.  Always use `pool.query()` or SECURITY DEFINER RPCs.
- **Setting `SUPABASE_JWT_SECRET`:** Breaks ES256 verification.  The env var must NOT be set.
- **Chaining JS awaits for atomic writes:** Two separate `pool.query()` calls can leave the DB in a partial state.  Use SECURITY DEFINER RPCs for multi-table writes.
- **Reading `cookies()` from `next/headers` in middleware:** Node.js API — not available in Workers runtime.  Use `request.cookies.get(...)` instead.
- **Using `@cloudflare/next-on-pages`:** Deprecated; Edge-only.  Use `@opennextjs/cloudflare`.
- **Starting with Next.js 14:** Support dropped Q1 2026 by OpenNext.  Scaffold on 15 immediately.
- **Exposing `auth.uid()` without specifying role in RLS:** Always use `TO authenticated` or `TO anon` in policies for query performance.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT verification | Custom JWKS fetcher | `jose` `createRemoteJWKSet` + `jwtVerify` | Handles key rotation, expiry, ES256 signature; onboarding doc explicitly says copy from accounts repo |
| Auth middleware | Custom token parser | Copy `requireAuth` from `backend/src/middleware/auth.ts` in accounts repo | Tested, handles all edge cases including `account_standing` check |
| Cloudflare deployment | Custom build scripts | `@opennextjs/cloudflare` adapter + `wrangler` | OpenNext handles all Next.js 15 features including RSC, streaming, ISR |
| Mobile detection | User-agent regex | Next.js built-in `userAgent()` from `next/server` | Maintained by Next.js team; `device.type === 'mobile'` is reliable |
| Database schema migrations | Manual SQL in Supabase dashboard | `supabase CLI` migration files + `supabase db push` | Reproducible, version-controlled, applies to prod cleanly |
| Design tokens | Custom CSS variables | `@empoweredvote/ev-ui` Tailwind preset | EV-UI is the source of truth; prevents drift from platform design |
| Silent token renewal | Custom refresh logic | `GET /api/auth/session` with `credentials: 'include'` | Accounts API handles the `ev_session` cookie; don't build a separate refresh flow |

**Key insight:** The accounts platform has already solved auth, JWT, session renewal, and role checking.  Phase 1's job is to wire into what exists, not rebuild it.

---

## Common Pitfalls

### Pitfall 1: Wrong Cloudflare Deployment Target

**What goes wrong:** Developer follows old Next.js + Cloudflare Pages tutorials, installs `@cloudflare/next-on-pages`, and gets a project that only runs in Edge runtime.  Server Actions, streaming, and node-postgres all fail.
**Why it happens:** Most search results and blog posts still document `next-on-pages`.
**How to avoid:** Use `npm create cloudflare@latest -- --framework=next --platform=workers` from the start.  If `wrangler.toml` has `pages_build_output_dir`, the wrong adapter is in use.
**Warning signs:** Build errors mentioning Edge runtime incompatibility; `pg` connection fails at runtime; `crypto` module not found.

### Pitfall 2: Next.js 14 Scaffold

**What goes wrong:** Developer scaffolds with Next.js 14 and OpenNext drops support mid-project.
**Why it happens:** Tutorials still reference Next.js 14; the locked requirement in the roadmap says "14" but 14 support was dropped Q1 2026.
**How to avoid:** Start fresh with `next@latest` (15.x or 16.x).  The async `cookies()`, async `params` patterns in Next.js 15 are non-negotiable — use the codemod if upgrading.
**Warning signs:** OpenNext adapter errors; `params` and `cookies()` TypeScript errors about synchronous access.

### Pitfall 3: PostgREST Writes to `listening` Schema

**What goes wrong:** `supabaseAdmin.schema('listening').from('debates').insert(...)` returns no error but inserts nothing.
**Why it happens:** PostgREST only exposes schemas registered in its allowlist.  `listening` is private by design.
**How to avoid:** All `listening` schema writes use `pool.query(...)` with the transaction pooler URL.  Never use the JS client `.schema()` call.
**Warning signs:** Inserts return success but data is absent; `schema not found` errors in logs.

### Pitfall 4: `SUPABASE_JWT_SECRET` Set

**What goes wrong:** JWT verification silently switches to symmetric HS256 and rejects all valid ES256 tokens.
**Why it happens:** Boilerplate Supabase setup instructions set this env var.
**How to avoid:** Do NOT include `SUPABASE_JWT_SECRET` in `.env.example` or any env file.  The `.env.example` comment should explicitly say "DO NOT SET SUPABASE_JWT_SECRET — this project uses ES256 JWKS".
**Warning signs:** 401 errors on all authenticated requests; valid tokens rejected.

### Pitfall 5: Auth Bypass Active in Non-Dev Environment

**What goes wrong:** `AUTH_BYPASS=1` set in staging or production leaks a backdoor admin user.
**Why it happens:** Misconfigured environment variables copied between environments.
**How to avoid:** Startup assertion: if `AUTH_BYPASS=1` and `NODE_ENV !== 'development'`, throw a hard error and refuse to start.  This is a locked decision from CONTEXT.md.
**Warning signs:** Bypass user appears in non-local environments.

### Pitfall 6: Missing `credentials: 'include'` on Cross-Origin Fetches

**What goes wrong:** Silent session renewal always fails; users get redirect-to-login loops.
**Why it happens:** The `ev_session` cookie is httpOnly and cross-origin.  Without `credentials: 'include'`, it is never sent.
**How to avoid:** Every `fetch` call to `api.empowered.vote` must include `credentials: 'include'`.
**Warning signs:** `GET /api/auth/session` always returns 401; login loop on page refresh.

### Pitfall 7: cookies() from next/headers in middleware.ts on Workers

**What goes wrong:** `import { cookies } from 'next/headers'` in `middleware.ts` causes a runtime crash on Cloudflare Workers.
**Why it happens:** `next/headers` cookies() is Node.js-only.
**How to avoid:** In `middleware.ts`, always use `request.cookies.get(...)` via the `NextRequest` object.
**Warning signs:** Worker startup crash with "cookies is not a function" or similar Node.js API error.

### Pitfall 8: Transaction Pooler + Prepared Statements

**What goes wrong:** `pg` connection fails with "prepared statements not supported in transaction mode."
**Why it happens:** Supabase transaction pooler (port 6543) does not support prepared statements.  Some `pg` queries use them implicitly.
**How to avoid:** Use only parameterized queries (`$1, $2`), not named prepared statements.  Set `prepare: false` if using Postgres.js instead of `pg`.
**Warning signs:** Database errors on first query; `ERROR: prepared statement does not exist`.

---

## Code Examples

Verified patterns from official sources:

### JWT Verification with JWKS (jose v6)

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §2.3 (authoritative)
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json')
);

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1',
    audience: 'authenticated',
    algorithms: ['ES256'],
  });
  return payload;
}
```

### userAgent Mobile Detection

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/userAgent (verified 2026-04-15)
import { userAgent } from 'next/server';
import type { NextRequest } from 'next/server';

export function isMobileDevice(request: NextRequest): boolean {
  const { device } = userAgent(request);
  // device.type is 'mobile', 'tablet', or undefined (desktop returns undefined)
  return device.type === 'mobile' || device.type === 'tablet';
}
```

### RLS Policy on Non-Public Schema Table

```sql
-- Source: EMPOWERED-LISTENING-ONBOARDING.md §4 + Supabase RLS docs
-- https://supabase.com/docs/guides/database/postgres/row-level-security

ALTER TABLE listening.debates ENABLE ROW LEVEL SECURITY;

-- Performance best practice: specify TO role, wrap auth.uid() in SELECT
CREATE POLICY "users can read own debates"
  ON listening.debates
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = created_by);
```

### SSO Redirect with Return URL

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §2.1
export function buildLoginUrl(returnUrl: string): string {
  return `https://accounts.empowered.vote/login?redirect=${encodeURIComponent(returnUrl)}`;
}

// On return, read from hash fragment (client-side only)
// The accounts SSO returns: #access_token=eyJ...&refresh_token=...
export function parseHashToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.slice(1));
  return params.get('access_token');
}
```

### account_standing Check (Per-Request, No Cache)

```typescript
// Source: EMPOWERED-LISTENING-ONBOARDING.md §3 + Next.js caching docs
// Wrap with React.cache for deduplication within single render pass
// fetch() default in Next.js 15 is no-store — this is correct behavior for account data
import { cache } from 'react';

export const getAccountMe = cache(async (accessToken: string) => {
  const res = await fetch('https://api.empowered.vote/api/account/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    credentials: 'include',
    // Next.js 15: fetch is NOT cached by default. No cache option needed.
    // Do NOT add cache: 'force-cache' — account_standing must be current.
  });
  if (!res.ok) throw new Error('Failed to fetch account');
  return res.json() as Promise<{
    id: string;
    display_name: string;
    tier: 'inform' | 'connected' | 'empowered';
    account_standing: 'active' | 'suspended' | 'restricted';
  }>;
});
```

**Recommendation (Claude's Discretion):** Fetch `account_standing` per-request, not session-level.  The accounts API returns fast, suspension takes effect immediately, and Next.js 15's default uncached fetch behavior makes this correct-by-default.  Use `React.cache()` to deduplicate within a single render pass if the same user data is needed in multiple components.

### .env.example Template

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://kxsdzaojfaibhuzmclfq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<redacted>
SUPABASE_SERVICE_ROLE_KEY=<redacted — server only, never expose to client>
DATABASE_TRANSACTION_POOLER_URL=postgres://<user>:<password>@<host>:6543/<db>?sslmode=require
# DO NOT SET SUPABASE_JWT_SECRET — this project uses ES256 JWKS verification

# Empowered Accounts API
ACCOUNTS_API_BASE=https://api.empowered.vote
JWKS_URL=https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json

# Service keys (provisioned by accounts maintainer)
LISTENING_GEM_KEY=<redacted>
LISTENING_XP_KEY=<redacted>

# Third-party services (Phase 1 provisioning)
LIVEKIT_URL=<redacted>
LIVEKIT_API_KEY=<redacted>
LIVEKIT_API_SECRET=<redacted>
CLOUDFLARE_ACCOUNT_ID=<redacted>
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=<redacted>
CLOUDFLARE_R2_BUCKET_NAME=<redacted>
CLOUDFLARE_R2_ACCESS_KEY_ID=<redacted>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<redacted>
DEEPGRAM_API_KEY=<redacted>

# Local dev only
# AUTH_BYPASS=1  — uncomment to bypass auth with mock user (dev only)
#                  App throws hard error if set outside NODE_ENV=development
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@cloudflare/next-on-pages` (Edge runtime) | `@opennextjs/cloudflare` (Node.js runtime) | Dec 2025 | Full App Router support; `pg` and node APIs available |
| Next.js 14 on Cloudflare | Next.js 15+ | Q1 2026 | 14 support dropped by OpenNext; must scaffold 15 |
| `cookies()` synchronous (Next.js 14) | `await cookies()` (Next.js 15) | Next.js 15.0 | Breaking change; codemod available |
| `params` destructured synchronously | `await params` (Next.js 15) | Next.js 15.0 | Breaking change for all layouts/pages with route params |
| `fetch` cached by default | `fetch` uncached by default | Next.js 15.0 | Correct default for user-specific data like `account_standing` |

**Deprecated/outdated:**
- `@cloudflare/next-on-pages`: Deprecated; Edge-only; do not use.
- `@next/font`: Removed in Next.js 15; use `next/font` instead.
- `experimental.serverComponentsExternalPackages`: Renamed to `serverExternalPackages` in Next.js 15.
- `inform.politicians` integer IDs: Migration artifacts, use `essentials.politicians` UUIDs.

---

## Open Questions

1. **accounts.empowered.vote CORS Registration**
   - What we know: The accounts API CORS allowlist must include `listening.empowered.vote` before cross-origin API calls work (onboarding doc §2.4).
   - What's unclear: Whether this is a self-service config or requires Chris to manually update the Render deployment.
   - Recommendation: Include "request CORS registration for listening.empowered.vote" as an explicit task in 01-04 (SSO auth).  Must be done before any API calls from the deployed app will work.

2. **`listening_host` and `listening_moderator` Role Slugs**
   - What we know: These role slugs must be registered with the accounts maintainer before the role system can be used (onboarding doc §9).
   - What's unclear: Phase 1 does not use roles yet (that's Phase 2+), but registering now prevents a blocker later.
   - Recommendation: Include role slug registration as a step in 01-04 or a note in the plan, even if roles are not enforced until Phase 2.

3. **Listening Gem Key and XP Key**
   - What we know: `LISTENING_GEM_KEY` and `LISTENING_XP_KEY` must be provisioned by the accounts maintainer (onboarding doc §5, §6).
   - What's unclear: These are not needed for Phase 1 (no gem/XP awards in foundation), but must be in `.env.example`.
   - Recommendation: Document them in `.env.example` as `<provisioned by accounts maintainer — not needed until Phase X>` and note the provisioning request as a Phase 1 task.

4. **EV-UI npm package availability**
   - What we know: `@empoweredvote/ev-ui` is published to npm with ESM + CJS bundles.  Tokens are in `ev-ui/src/tokens.js`.  A Tailwind preset is available.
   - What's unclear: The exact package version and whether the Tailwind preset supports Tailwind v4 (shadcn init uses v3 or v4 depending on init flags).
   - Recommendation: Resolve version compatibility during scaffold step.  If Tailwind v4 is incompatible with the ev-ui preset, use the CSS token import path directly.

5. **`@empoweredvote/ev-ui` server-side component compatibility**
   - What we know: EV-UI uses React 17+ and `@react-spring/web` for animations.
   - What's unclear: Whether animated components are marked `'use client'` or whether they require special Next.js 15 handling.
   - Recommendation: For Phase 1, only consume design tokens (colors, typography, spacing) from the preset — avoid importing animated components until compatibility is verified.

---

## Sources

### Primary (HIGH confidence)
- `EMPOWERED-LISTENING-ONBOARDING.md` (v1.0, 2026-04-19) — SSO flow, JWT pattern, schema setup, pool.query rule, all API endpoints.  This is the definitive integration document.
- `https://nextjs.org/docs/app/api-reference/functions/userAgent` — `userAgent()` API, `device.type` values (verified 2026-04-15, Next.js 16.2.4 docs)
- `https://nextjs.org/docs/app/guides/upgrading/version-15` — Next.js 15 breaking changes: async cookies/params, uncached fetch (verified 2026-04-15)
- `https://nextjs.org/docs/app/getting-started/fetching-data` — React.cache() deduplication pattern, per-request fetch behavior (verified 2026-04-15)
- `https://opennext.js.org/cloudflare/get-started` — OpenNext setup steps, wrangler.jsonc, package.json scripts (official docs)
- `https://developers.cloudflare.com/pages/configuration/custom-domains/` — Domain setup for `listening.empowered.vote`
- `https://supabase.com/docs/guides/database/postgres/row-level-security` — RLS patterns, schema-prefix syntax, performance best practices
- `github.com/empoweredvote/ev-ui` — Design token structure (Manrope font, coral/teal/yellow palette, 4px scale, Tailwind preset)

### Secondary (MEDIUM confidence)
- OpenNext deprecation of `@cloudflare/next-on-pages` confirmed across multiple Cloudflare blog posts and community reports (Dec 2025)
- Next.js 14 support drop in OpenNext Q1 2026 confirmed by opennext.js.org documentation
- Transaction pooler (port 6543) requirement for serverless Postgres confirmed by Supabase docs and Cloudflare Workers docs

### Tertiary (LOW confidence)
- EV-UI Tailwind v4 compatibility — not verified; recommend testing during scaffold
- Exact `@empoweredvote/ev-ui` npm version — WebSearch found the package exists; npm registry returned 403

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Core libraries verified via official docs and onboarding doc
- Architecture: HIGH — Patterns are from official sources and authoritative internal docs
- Pitfalls: HIGH — PostgREST limitation and JWKS pattern from onboarding doc; Workers/cookies issue from Next.js + Cloudflare official docs
- Deployment target (Workers vs Pages): HIGH — Confirmed via Cloudflare official docs and opennext.js.org
- Version recommendation (Next.js 15): HIGH — OpenNext drop of 14 confirmed on opennext.js.org
- EV-UI token details: MEDIUM — Fetched from GitHub raw source; Tailwind preset compatibility with v4 is LOW

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (Cloudflare/OpenNext is fast-moving; re-verify adapter version before major upgrades)
