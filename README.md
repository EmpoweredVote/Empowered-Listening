# Empowered Listening

Structured civic debate infrastructure for Empowered Vote.  Two speakers and a
moderator run a fair, accountable debate while any connected observer watches
live.  A permanent, searchable transcript is produced automatically.

## Stack

- **Next.js 15+** with App Router and Turbopack
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **Supabase** (Postgres, auth JWKS, storage)
- **EV-UI** design system (Manrope font, ev-muted-blue, ev-coral)

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .dev.vars.example .dev.vars
# Fill in real values from Supabase dashboard and service providers

# 3. Start dev server (Next.js with Turbopack)
npm run dev
# App runs at http://localhost:3000

# 4. (Optional) Preview Cloudflare Workers locally
npm run preview
```

## Deploy

```bash
# Build and deploy to Cloudflare Workers
npm run build
npm run deploy
```

Requires `npx wrangler login` (one-time browser OAuth).  After first deploy,
attach `listening.empowered.vote` via Cloudflare Dashboard:
Workers and Pages -> empowered-listening -> Settings -> Domains and Routes -> Add Custom Domain.

## Environment variables

See `.env.example` for the full list with descriptions.  Never set
`SUPABASE_JWT_SECRET` — this project uses ES256 JWKS verification exclusively.

Key vars for Phase 1:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin access |
| `DATABASE_TRANSACTION_POOLER_URL` | Postgres connection (port 6543, tx mode) |
| `ACCOUNTS_API_BASE` | Empowered Accounts API base URL |
| `JWKS_URL` | ES256 JWKS endpoint for JWT verification |

## Schema

All application data lives in the `listening` Postgres schema (not `public`).
Use `pool.query()` for all writes — PostgREST does not expose non-public schemas.

Migrations: `supabase/migrations/`
Apply: `supabase db push --linked`
