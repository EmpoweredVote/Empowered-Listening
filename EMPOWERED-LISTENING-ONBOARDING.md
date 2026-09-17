# Empowered Listening — Accounts Integration Onboarding

**Version:** 1.0 (2026-04-19)
**Audience:** The Empowered Listening team integrating a new Connect-pillar feature with Empowered Accounts.
**Accounts API version:** v2.0 (INTEGRATION-GUIDE-v2.md)

Read this before writing any code that touches authentication, user identity, tiers, gems, social graph, or civic data.

---

## Contents

1. [Platform Context](#1-platform-context)
2. [Authentication and SSO](#2-authentication-and-sso)
3. [Tier System — What Connected Means](#3-tier-system--what-connected-means)
4. [Your Own Schema](#4-your-own-schema)
5. [Gems — Blue Gem Integration](#5-gems--blue-gem-integration)
6. [XP — Optional Engagement Layer](#6-xp--optional-engagement-layer)
7. [Social Graph](#7-social-graph)
8. [Meeting Data](#8-meeting-data)
9. [Role System — Moderators and Hosts](#9-role-system--moderators-and-hosts)
10. [Admin System](#10-admin-system)
11. [What Not to Build](#11-what-not-to-build)
12. [Anti-Patterns](#12-anti-patterns)
13. [Onboarding Checklist](#13-onboarding-checklist)

---

## 1. Platform Context

### What is Empowered Vote?

Empowered Vote is a civic platform solving two problems: political polarization and civic impotence. It exists to help citizens find shared facts, unpack shared values, and create shared solutions. Every feature must be able to answer: *does this serve the user, or is it designed at their expense?*

The platform is organized into three pillars:

- **Inform** — Finding Shared Facts. Maximum reach, no account required. Game mechanics make civic information engaging.
- **Connect** — Unpacking Shared Values. Authenticated, pseudonymous community. Identity-verified with one voice per person.
- **Empower** — Creating Shared Solutions. Connected users who become civic leaders. Full legal-name transparency.

**Empowered Listening lives in the Connect Pillar.** Its core audience is identity-verified community members. Core participation (listening to hearings, commenting, engaging with others) requires a Connected account.

### Design Constraints That Apply to Listening

- **One voice per person.** No duplicate accounts. The Connected tier's invite-only identity verification is the enforcement layer — Listening inherits this guarantee automatically.
- **No pay-to-win.** Never design mechanics where money, gems, or XP can substitute for genuine civic engagement.
- **Pseudonymity by default.** Use `display_name` from `connected_profiles` in all UI. Never surface `legal_name` to other users. Only Empowered users have public legal names, and that is their explicit consent.
- **Suspended users are silenced.** Any user with `account_standing: 'suspended'` must be blocked from participation — posting, reacting, earning rewards. Check this before every civic action.
- **Privacy by default.** Collect only what is needed. Do not store a user's full address, legal name, or any field from `empowered_profiles` in your own schema.

---

## 2. Authentication and SSO

### 2.1 The SSO Pattern

Users never log in directly at an Empowered Listening URL. All authentication flows through `accounts.empowered.vote`. This is non-negotiable — it is what makes a single identity work across every Empowered Vote feature.

**Flow:**

1. User visits Empowered Listening and is not authenticated.
2. Redirect to the Auth Hub:
   ```
   https://accounts.empowered.vote/login?redirect={encodeURIComponent(returnUrl)}
   ```
3. User logs in at `accounts.empowered.vote`.
4. On success, Accounts redirects back to `returnUrl` with `#access_token=eyJ...&refresh_token=...` in the URL hash.
5. Read `location.hash`, extract `access_token`, store it (e.g., `localStorage.setItem('ev_token', token)`).
6. All authenticated API calls: `Authorization: Bearer <access_token>`.

### 2.2 Silent Session Renewal

The `ev_session` httpOnly cookie is set at login. On app load, call this before showing a login prompt:

```javascript
const res = await fetch('https://api.empowered.vote/api/auth/session', {
  credentials: 'include', // required for the cross-origin cookie
});
if (res.ok) {
  const { access_token } = await res.json();
  localStorage.setItem('ev_token', access_token);
  // user is silently re-authenticated — no login redirect needed
}
// 401 = no valid session — redirect to login
```

Always send `credentials: 'include'` on every cross-origin fetch. Without it, the `ev_session` cookie is never sent and silent renewal breaks.

### 2.3 JWT Verification (If You Have Your Own Backend)

JWTs are signed with **ES256 (asymmetric P-256)**. Use `jose` with the JWKS endpoint — not `jsonwebtoken` with a symmetric secret.

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json')
);

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1',
      audience: 'authenticated',
    });
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

**Do NOT set `SUPABASE_JWT_SECRET`.** ES256 uses JWKS. Setting the old symmetric secret will cause all token verifications to fail.

### 2.4 CORS Registration

Your app's origin must be in the API's CORS allowlist. Contact the Empowered Accounts maintainer with your domain (e.g., `listening.empowered.vote`) before launch. Calls from an unregistered origin will be blocked.

---

## 3. Tier System — What Connected Means

### The Three Tiers

**Tier = child record presence, never a status flag.**

```
auth.users                              ← Supabase Auth
    └── public.users                    ← platform identity
        ├── connect.connected_profiles  ← exists when Connected (verified)
        └── empower.empowered_profiles  ← exists when Empowered (civic leader)
```

| Tier | What it means | Listening access |
|------|--------------|-----------------|
| **Inform** | No child records. Signed up but not verified. | Browse-only. Cannot post, react, or earn rewards. |
| **Connected** | Identity-verified pseudonym. One voice per person. | Full participation. |
| **Empowered** | Connected + civic leader. Legal name public. | Full participation. May have hosting/moderation roles. |

### Getting a User's Tier

```
GET https://api.empowered.vote/api/account/me
Authorization: Bearer <access_token>
```

Key fields in the response:

```json
{
  "id": "uuid",
  "display_name": "JaneDoe",
  "tier": "connected",
  "account_standing": "active",
  "location_consent": true,
  "jurisdiction": {
    "city": "Bloomington",
    "state": "IN",
    "county": "...",
    "city_council_district": "..."
  },
  "connected_profile": {
    "display_name": "JaneDoe",
    "verification_status": "verified",
    "xp": { "total": 1800, "level": 2, "xp_in_level": 1800, "xp_to_next_level": 200 },
    "gems": { "yellow": 20, "blue": 5, "red": 0 }
  }
}
```

- **`account_standing`** — check this before every civic write. `suspended` users must be blocked.
- **`tier`** — the computed tier: `inform | connected | empowered`.
- **`jurisdiction`** — the user's stored geo jurisdiction (present when `location_consent: true`). Useful for surfacing locally-relevant hearings.
- **`display_name`** — always use this in UI, never `legal_name`.

### Middleware Guards

The accounts API exposes middleware your backend can replicate:

| Guard | Meaning | HTTP error |
|-------|---------|-----------|
| `requireAuth` | Valid, unexpired JWT | 401 |
| `requireConnected` | Connected or Empowered tier | 403 |
| `requireAdmin` | Empowered Accounts admin | 403 |
| `optionalAuth` | JWT validated if present; null if absent | Never blocks |

Copy these patterns from `backend/src/middleware/` in the accounts repo. Do not rewrite JWT verification from scratch.

---

## 4. Your Own Schema

Empowered Listening needs its own Postgres schema. **Never add tables to `public`, `connect`, `empower`, or `inform`.** Those schemas are owned by Empowered Accounts.

```sql
CREATE SCHEMA listening;

-- Example tables
CREATE TABLE listening.sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL,              -- references a meeting UUID from the accounts API
  title       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming','live','archived'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE listening.session_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES listening.sessions(id),
  user_id     UUID NOT NULL REFERENCES public.users(id),  -- always reference public.users
  body        TEXT NOT NULL,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE listening.reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES listening.session_posts(id),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  type        TEXT NOT NULL,              -- 'agree','disagree','flag' etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, type)        -- one reaction per type per user per post
);
```

**User foreign keys always point to `public.users(id)`.** Never reference `auth.users` directly.

### RLS Policies

Add RLS policies to your tables so that service-role bypasses work correctly and user-scoped client reads are enforced:

```sql
ALTER TABLE listening.session_posts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically
-- Users can only see posts in sessions that are live or archived
CREATE POLICY "read posts" ON listening.session_posts
  FOR SELECT USING (true); -- customize to your visibility rules

-- Users can only insert their own posts
CREATE POLICY "insert own posts" ON listening.session_posts
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

### Multi-Table Writes Must Use SECURITY DEFINER RPCs

Never chain JS `await` calls for writes that must be atomic. If posting a comment should also insert a notification row and update a counter, that must be a single Postgres function:

```sql
CREATE OR REPLACE FUNCTION listening.post_comment(
  p_user_id     UUID,
  p_session_id  UUID,
  p_body        TEXT
)
RETURNS listening.session_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post listening.session_posts;
BEGIN
  INSERT INTO listening.session_posts (session_id, user_id, body)
  VALUES (p_session_id, p_user_id, p_body)
  RETURNING * INTO v_post;

  -- any additional atomic side effects go here

  RETURN v_post;
END;
$$;
```

Call it via:
```typescript
const { data, error } = await supabaseAdmin.rpc('listening.post_comment', {
  p_user_id: userId,
  p_session_id: sessionId,
  p_body: body,
});
```

### Non-Public Schema Writes

`supabaseAdmin.schema('listening').from('session_posts').insert(...)` via PostgREST **will fail**. PostgREST only exposes schemas registered in the allowlist. For all writes to the `listening` schema, use `pool.query()` or SECURITY DEFINER RPCs:

```typescript
// WRONG
await supabaseAdmin.schema('listening').from('session_posts').insert({ ... });

// CORRECT
await pool.query(
  'INSERT INTO listening.session_posts (session_id, user_id, body) VALUES ($1, $2, $3)',
  [sessionId, userId, body]
);
```

---

## 5. Gems — Blue Gem Integration

Gems are the platform reward currency. Empowered Listening is a Connect-pillar feature. Awards for civic community engagement use **blue gems**.

| Gem | Color | Domain |
|-----|-------|--------|
| `yellow` | ev-yellow | Inform (knowledge, facts) |
| `blue` | ev-teal | Connect (community, trust, engagement) |
| `red` | ev-red | Empower (civic leadership) |

### Awarding Blue Gems

Gem awards are server-to-server only. Never trigger a gem award from client-side code.

**Step 1:** Contact the Empowered Accounts maintainer to provision a gem service key for Listening. You'll receive a secret string. Store it as `LISTENING_GEM_KEY` in your server environment.

**Step 2:** Call the award endpoint from your backend:

```typescript
const res = await fetch('https://api.empowered.vote/api/gems/award', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.LISTENING_GEM_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_id: userId,
    gem_type: 'blue',
    amount: 10,
    idempotency_key: `listening-post-${postId}-${userId}`,
  }),
});

const result = await res.json();
// result.is_duplicate: true = already awarded, no-op
// result.new_balance: { yellow, blue, red }
```

**Idempotency key pattern:** `listening-<event_type>-<event_id>-<user_id>`

Examples:
- `listening-post-<postId>-<userId>` — for posting a comment
- `listening-session-attended-<sessionId>-<userId>` — for attending a full session
- `listening-first-reaction-<sessionId>-<userId>` — for first reaction in a session

Every possible award event needs exactly one unique key. Keys are permanent — the same key always returns the original result with `is_duplicate: true`.

### Reading Gem Balances

Users can read their own balances:

```
GET https://api.empowered.vote/api/gems/balance
Authorization: Bearer <access_token>   (Connected required)
Returns: { "yellow": 20, "blue": 15, "red": 0 }
```

Balances are also in the `GET /api/account/me` response under `connected_profile.gems`.

---

## 6. XP — Optional Engagement Layer

XP is a platform-wide engagement ledger. If Listening awards XP for participation, coordinate with the Empowered Accounts maintainer to:

1. Register a new `source` string for Listening (e.g., `empowered_listening_session`).
2. Receive an `X-Service-Key` value scoped to that source.

Award pattern:

```typescript
const res = await fetch('https://api.empowered.vote/api/xp/award', {
  method: 'POST',
  headers: {
    'X-Service-Key': process.env.LISTENING_XP_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_id: userId,
    source: 'empowered_listening_session',
    amount: 50,
    idempotency_key: `listening-session-${sessionId}-${userId}`,
    metadata: {
      session_id: sessionId,
      duration_minutes: 45,
      posts_made: 3,
    },
  }),
});
```

The award response includes `level`, `total_xp`, `xp_in_level`, and `xp_to_next_level` — use these directly on your post-session screen without a second fetch.

**Metadata note:** Do not include PII (email, display name, IP) in `metadata`. It is stored permanently and visible to admins.

---

## 7. Social Graph

Empowered Listening can leverage the existing social graph for surfacing who in your network is attending a session, following a civic leader who is presenting, etc.

**Read-only social graph endpoints (Connected required):**

```
GET /api/social/peers         — user's peer connections (pending + accepted)
GET /api/social/following     — accounts the user is following
GET /api/social/followers/:userId — follower count for an Empowered user
```

**Write endpoints** (follow/unfollow Empowered accounts, peer connection requests) exist at `/api/social/*`. If Listening surfaces civic leaders presenting at sessions, use the follow endpoints to let users subscribe to their future activity.

Do not build a separate follow/friend system for Listening. Use the shared social graph.

---

## 8. Meeting Data

The accounts API exposes structured meeting data — transcripts, summaries, votes, and AI-generated summaries — at `/api/meetings`. Empowered Listening should consume this data rather than maintaining its own copy.

**Key endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/meetings` | None | List with `?city=&state=&status=completed` filters |
| `GET` | `/api/meetings/:id` | None | Meeting by UUID |
| `GET` | `/api/meetings/:id/transcript` | None | Paginated transcript (`?page=1`) |
| `GET` | `/api/meetings/:id/summary` | None | AI meeting summary |
| `GET` | `/api/meetings/:id/votes` | None | Vote records |

If Listening needs to associate a `listening.session` with a specific government meeting, store the `meeting_id` UUID in your own table and call these endpoints to hydrate the view.

**Representative context:** If a user has location consent, you can surface which of their representatives are participating in a meeting. Use:

```
GET /api/essentials/representatives/me
Authorization: Bearer <access_token>   (Connected required)
```

This returns politicians for the user's stored jurisdiction (no geocoding needed). Cross-reference with meeting participants.

---

## 9. Role System — Moderators and Hosts

If Empowered Listening has a concept of a "session host" or "moderator," use the platform role system rather than building a separate permissions layer.

**Requesting a role slug:** Contact the Empowered Accounts maintainer to register a new role (e.g., `listening_host`, `listening_moderator`). The admin UI will then be able to grant/revoke it.

**Checking a role in your backend:**

```typescript
const res = await fetch('https://api.empowered.vote/api/roles/check', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    feature_scope: 'listening_host',
    jurisdiction_geoid: userJurisdictionGeoid, // or omit for unrestricted check
  }),
});
const { permitted } = await res.json();
```

**Cache behavior:** Role check results are cached server-side for up to 90 seconds after revocation. Design your feature to tolerate this window.

**Alternative — fetch all grants:**

```
GET /api/roles/me
Authorization: Bearer <access_token>   (Connected required)
```

Returns all of the user's active role grants. Scan for `role_slug === 'listening_host'`.

---

## 10. Admin System

The admin system is shared across the platform. Empowered Accounts admins can already view user accounts, suspend users, and grant/revoke roles. You should not build a separate admin auth system.

**Admin endpoints useful for Listening:**

| Route | Description |
|-------|-------------|
| `GET /api/admin/accounts/:userId` | Full user detail (tolerance_rating, legal_name, all roles) |
| `POST /api/admin/accounts/:userId/suspend` | Suspend an account platform-wide |
| `POST /api/admin/roles/grant` | Grant `listening_host` or `listening_moderator` to a user |
| `POST /api/admin/roles/revoke` | Revoke a role |

If Listening needs its own admin UI for session management (scheduling sessions, managing participants, reviewing flagged posts), build it in your own admin tool and call the shared admin API for any user-level actions. The auth pattern for admin routes is `requireAuth` + `requireAdmin`, same as accounts.

**Audit log:** Any mutation that affects user standing, access, or civic participation should be logged to `admin_audit_log` in the accounts database. Contact the accounts maintainer to add log entries from Listening's RPCs if needed.

---

## 11. What Not to Build

These exist. Do not build parallel versions.

| You need... | Use instead |
|-------------|-------------|
| User signup / login | SSO redirect to `accounts.empowered.vote/login` |
| JWT verification middleware | Copy from `backend/src/middleware/auth.ts` |
| Tier checking | Copy from `backend/src/middleware/tierGuards.ts` |
| Gem ledger | `POST /api/gems/award` (service key required) |
| XP ledger | `POST /api/xp/award` (service key required) |
| Follow system | `POST /api/social/follow`, `DELETE /api/social/follow/:id` |
| Peer connections | `POST /api/social/peers/request`, accept/decline routes |
| Role/permission system | `POST /api/roles/check`, `GET /api/roles/me` |
| Admin user management | `GET /api/admin/accounts`, suspend/unsuspend routes |
| Meeting transcripts | `GET /api/meetings/:id/transcript` |
| Representative lookup | `GET /api/essentials/representatives/me` |

---

## 12. Anti-Patterns

### Don't expose `tolerance_rating` or `legal_name`

Both are returned from `GET /api/account/me` under nested objects (owner self-view only). Never surface these in Listening's API responses or UI. The serialization layer enforces this — do not work around it.

### Don't use integer politician IDs

All politician references on the platform use `essentials.politicians` UUIDs. If Listening surfaces civic leaders, use their UUID. The old `inform.politicians` integer IDs are migration artifacts.

### Don't write to non-public schemas via PostgREST

`supabaseAdmin.schema('listening').from('...').insert()` will fail. Use `pool.query()` or SECURITY DEFINER RPCs for all `listening` schema writes. Same applies to any reads you proxy from `essentials`, `transparent_motivations`, or `treasury`.

### Don't chain JS awaits for atomic operations

```typescript
// WRONG — second write can fail after first succeeds
await pool.query('INSERT INTO listening.session_posts ...');
await pool.query('UPDATE listening.session_stats ...');

// CORRECT — single atomic RPC
await supabaseAdmin.rpc('listening.post_comment', { ... });
```

### Don't allow suspended users to participate

Always check `account_standing` before any civic write. A suspended user retains a valid JWT — `requireAuth` alone does not block them. The accounts `requireConnected` middleware handles this check.

### Don't set `SUPABASE_JWT_SECRET`

The shared Supabase project uses ES256 (asymmetric). Setting `SUPABASE_JWT_SECRET` will break JWT verification. Use JWKS verification (see Section 2.3).

### Don't use the old Go server URL

The Go server (`ev-backend-h3n8.onrender.com`) is permanently down. All API calls go to `api.empowered.vote`.

---

## 13. Onboarding Checklist

Work through this before going live:

**Accounts coordination:**
- [ ] Request your app's domain added to `CORS_ORIGIN` on the Render deployment
- [ ] Request a blue gem service key (`LISTENING_GEM_KEY`)
- [ ] Request an XP service key + source slug if Listening awards XP
- [ ] Request role slugs for any Listening-specific roles (e.g., `listening_host`)

**Authentication:**
- [ ] SSO redirect implemented — users login at `accounts.empowered.vote/login?redirect=...`
- [ ] `#access_token=` hash fragment correctly parsed and stored
- [ ] `GET /api/auth/session` with `credentials: 'include'` on every app load
- [ ] All cross-origin fetch calls send `credentials: 'include'`
- [ ] JWT verification using JWKS (not `SUPABASE_JWT_SECRET`)

**Tier and standing enforcement:**
- [ ] `account_standing` checked before every civic write
- [ ] Inform-tier users get browse-only experience (no posts, no reactions)
- [ ] `display_name` used in all UI (never `legal_name`)
- [ ] `tolerance_rating` never surfaced in API responses

**Schema and database:**
- [ ] `listening` schema created in migration file under `supabase/migrations/`
- [ ] All user FKs point to `public.users(id)`, not `auth.users`
- [ ] RLS policies added to all `listening` tables
- [ ] All multi-table writes use SECURITY DEFINER RPCs
- [ ] No PostgREST writes to `listening` schema — use `pool.query()` only
- [ ] TypeScript types regenerated to include `listening` schema

**Rewards:**
- [ ] Idempotency key pattern defined for each award event
- [ ] Gem awards called from server only, never client
- [ ] `is_duplicate: true` handled gracefully in award response

**Infrastructure:**
- [ ] Health check at `GET /api/health` called before live sessions if needed
- [ ] `HTTPS` only — no plain HTTP calls

---

*Empowered Accounts v2.0 — 2026-03-29*
*Listening Onboarding Guide — 2026-04-19*
*Maintainer: Chris — Founder, Empowered Vote*
