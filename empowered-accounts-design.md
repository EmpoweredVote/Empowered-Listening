# Empowered Vote — Accounts System Design Document

**Feature:** `empowered-accounts`
**Status:** Design Phase — Pre-Alpha
**Audience:** This document is for design exploration with Opus. It describes intended behavior, data models, user journeys, and open architectural questions for the account tier system.

---

## Context: Why Accounts Are the Foundation

Every meaningful feature on Empowered Vote is downstream of accounts. The Inform Pillar is open to everyone — but the moment a user wants to participate (post, connect, lead), they move through this system.

More importantly, a user's account tier determines the privacy model of all their data. Getting this right is not just a technical problem — it is an expression of the platform's values. We protect citizens from anonymity-based manipulation while also protecting them from government surveillance. We give civic leaders the transparency that leadership requires while protecting regular citizens' right to privacy.

The accounts system is where we operationalize all of that.

---

## The Three Tiers

### Tier 0: Inform (No Account)
Open to everyone. No authentication required. Anonymous users can:
- Search representatives by ZIP code via Empowered Essentials
- View all representative profiles (compass, voting records, funding sources)
- Calibrate their own Empowered Compass (stored in browser localStorage)
- Compare their compass with any Empowered Account
- Complete Read & Rank exercises (blind — attribution revealed after ranking)
- Unlock and earn Empowered Badges through civic games
- Play Civic Trivia Championship

Anonymous users **cannot**:
- Display their badge collection (no profile to attach it to)
- Have their compass persist across devices or browser clears
- Participate in any Connect Pillar features
- Submit messages to representatives

**Anonymous compass storage:** localStorage only. Always provide a JSON export option so users can preserve calibration. When they create a Connected account, an import flow migrates their localStorage calibration to the database.

---

### Tier 1: Connected Account

The gateway to civic participation. Identity-verified, pseudonymous.

**Requirements to Connect:**
1. Commit to searching for shared solutions (not just debate for sport)
2. Verify identity — one person, one account
3. Confirm residency — you live where you claim

**What Connected unlocks:**
- Persistent compass calibration (database, any device)
- Posting in Civil Civics (local), Equal Slice (broader communities), Common Grounds
- Symposium access as audience member (observing, not speaking)
- Empowered Gems — earning and spending
- Veracity Rating (tracked publicly on all posts)
- Tolerance Rating (tracked privately for Connected users — never shared; becomes public upon Empowerment)
- XP system spanning Inform games and Connect contributions
- Compass sharing (optional — private by default)
- Badge collection display (optional — private by default)
- Peer connections (mutual) and follows (1-way, toward Empowered Accounts)
- Role eligibility: Moderator, Juror, Journo, Arbiter, Educator

**Identity model:** Connected users choose a `display_name` (pseudonym). Their legal identity is verified but never publicly visible. Privacy is the default; sharing is always opt-in.

---

### Tier 2: Empowered Account

A civic leader. The trade is explicit: **privacy for influence.**

**Requirements to Empower (all must be met before transition):**
1. Active Connected Account with `verification_status: 'verified'`
2. Full compass calibration — all 20 live Top Priority topics answered, plus any role-relevant extras. Not just the 5–8 topics shown on their visible compass — every topic.
3. Explicit agreement that all compass stances become public
4. Submission of legal (real) name

**What Empowered unlocks:**
- Public candidate page with full compass, voting record overlays, funding sources
- **Tolerance Rating becomes publicly visible** (civic leaders are held to full transparency)
- **Awareness Exchange investment history becomes public** (their "civic called shots" are visible to all)
- Symposium access as speaker (not just observer)
- Role eligibility: Maven, Guide, Scribe
- Ability to propose and develop Empowered Bills
- Solutions on the Awareness Exchange
- Democracy 2.0 participation
- Empowered Candidates infrastructure (running for office without fundraising dependency)

**The empowerment moment is an atomic transaction:**
1. Create `empowered_profiles` record
2. Batch update all `inform.compass_responses.visibility` → `'public'` for this user
3. Generate `candidate_page_slug`
4. Swap display surface from `display_name` → `legal_name`

If any step fails, roll back entirely. Partial empowerment is never a valid state.

**Demotion:** Empowered users can return to Connected at any time. Sets `empowered_profiles.is_active = false`, batches compass visibility back to `'private'`. Candidate page becomes inactive. Fully reversible.

**Calibration maintenance:** When a new topic goes live, Empowered Accounts have 30 days to calibrate. Failure triggers automatic demotion to Connected. Completing the missing calibration restores Empowered status on request.

---

## Data Model

### Core Tables

```sql
-- Supabase Auth manages auth.users
-- We extend it:

CREATE TABLE public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE connect.connected_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES public.users(id),
  display_name          TEXT NOT NULL,
  verification_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'suspended')),
  verification_method   TEXT,                   -- TBD (see Open Questions)
  verified_region       TEXT,                   -- state/district confirmed at verification
  xp                    INTEGER NOT NULL DEFAULT 0,
  gem_balance           INTEGER NOT NULL DEFAULT 0,
  gem_reserve_cap       INTEGER NOT NULL DEFAULT 1000,
  veracity_rating       NUMERIC(4,2),           -- public (shown on all posts)
  tolerance_rating      NUMERIC(4,2),           -- private for Connected; public for Empowered (never returned to other users via API for Connected accounts)
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE empower.empowered_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES public.users(id),
  connected_profile_id  UUID NOT NULL REFERENCES connect.connected_profiles(id),
  legal_name            TEXT NOT NULL,
  empowered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  candidate_page_slug   TEXT UNIQUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

### Compass Tables

```sql
CREATE TABLE inform.compass_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,           -- e.g. 'healthcare-access'
  label           TEXT NOT NULL,                  -- display title
  short_label     TEXT,                           -- for compact compass display
  start_phrase    TEXT,                           -- e.g. "The federal government should"
  category        TEXT,                           -- e.g. 'Healthcare and Social Safety Nets'
  status          TEXT NOT NULL DEFAULT 'live'
    CHECK (status IN ('live', 'iceboxed', 'retired')),
  display_order   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Role-based topic relevance (city council ≠ congress)
CREATE TABLE inform.compass_topic_roles (
  topic_id        UUID NOT NULL REFERENCES inform.compass_topics(id),
  role_scope      TEXT NOT NULL,                  -- 'city_council' | 'state_legislature' | 'us_congress' | 'president'
  is_required     BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (topic_id, role_scope)
);

-- Pre-written stances for each topic (5 per topic)
CREATE TABLE inform.compass_stances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    UUID NOT NULL REFERENCES inform.compass_topics(id),
  position    NUMERIC(3,1) NOT NULL,              -- 1.0, 2.0, 3.0, 4.0, 5.0
  stance_text TEXT NOT NULL,
  UNIQUE (topic_id, position)
);

-- User calibration responses
CREATE TABLE inform.compass_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id),
  topic_id        UUID NOT NULL REFERENCES inform.compass_topics(id),
  stance_value    NUMERIC(3,1) NOT NULL,          -- 1.0–5.0; .5 increments for custom
  stance_type     TEXT NOT NULL DEFAULT 'preset'
    CHECK (stance_type IN ('preset', 'custom')),
  stance_text     TEXT NOT NULL,                  -- pre-written text or user-written
  inverted        BOOLEAN NOT NULL DEFAULT false, -- user has flipped this spoke's direction
  visibility      TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'friends', 'public')),
  calibrated_at   TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, topic_id)
);

-- Full change history for volatility tracking
CREATE TABLE inform.compass_change_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id),
  topic_id        UUID NOT NULL REFERENCES inform.compass_topics(id),
  old_value       NUMERIC(3,1) NOT NULL,
  new_value       NUMERIC(3,1) NOT NULL,
  old_stance_type TEXT,
  change_context  TEXT,                           -- optional user annotation
  changed_at      TIMESTAMPTZ DEFAULT now()
);
```

**Note on the inversion mechanic:** The `inverted` boolean is per-user, per-topic and must be respected everywhere a compass is rendered. When `inverted = true`, position 1 renders at the outer edge and position 5 at the center. This is stored on `compass_responses` and applied consistently across all platform surfaces — Essentials, comparison views, profile pages, everywhere.

### Connections & Follows

```sql
-- Mutual peer connections (Connect tier — both parties agree)
CREATE TABLE connect.peer_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    UUID NOT NULL REFERENCES public.users(id),
  addressee_id    UUID NOT NULL REFERENCES public.users(id),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (requester_id, addressee_id)
);

-- 1-way follows (any Connected → any Empowered; no mutual agreement needed)
CREATE TABLE connect.account_follows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id     UUID NOT NULL REFERENCES public.users(id),
  followed_id     UUID NOT NULL REFERENCES public.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (follower_id, followed_id)
);
```

### Roles

```sql
CREATE TYPE public.role_type AS ENUM (
  'maven', 'journo', 'arbiter', 'moderator',
  'juror', 'educator', 'guide', 'scribe'
);

CREATE TABLE public.user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  role_type   role_type NOT NULL,
  granted_at  TIMESTAMPTZ DEFAULT now(),
  revoked_at  TIMESTAMPTZ,                        -- NULL = currently active
  UNIQUE (user_id, role_type)
);
```

### Empowered Gems Ledger

```sql
CREATE TABLE connect.gem_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id),
  amount            INTEGER NOT NULL,             -- positive = credit, negative = debit
  transaction_type  TEXT NOT NULL,
    -- 'stipend' | 'earned_inform' | 'earned_connect' | 'spent' | 'expired'
  feature_context   TEXT,                         -- which feature/schema originated this
  reference_id      UUID,                         -- FK to whatever was purchased/earned
  balance_after     INTEGER NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

### Verification Sessions (Connect Flow)

```sql
-- Stores in-progress Connect verification (resumable if user abandons)
CREATE TABLE connect.verification_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id),
  step_reached        TEXT NOT NULL,              -- which step they got to
  display_name_draft  TEXT,
  verification_method TEXT,
  region_draft        TEXT,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## Privacy & Security Rules

These are enforced at both the RLS (database) and application layers. RLS is primary.

- `tolerance_rating` is **never** returned in any API response to any user other than the account owner. Not in `/api/account/me`. Not anywhere. Internal platform systems only.
- `legal_name` is **never** returned for a Connected user. Only stored on `empowered_profiles` and only surfaced after empowerment.
- `verification_method` and raw verification data are **never** returned to any client. Internal only.
- `compass_responses` with `visibility: 'private'` are **never** returned except to the owning user.
- `compass_responses` with `visibility: 'friends'` are returned only to users with an accepted `peer_connections` record with the owner.
- `compass_responses.stance_text` where `stance_type = 'custom'` for Connected users is **private only** — not returned to any other user. For Empowered users, custom stance text is public (cost of leadership).

---

## User Journeys

### Journey 1: Anonymous → Connected

**Entry points:** Post-game prompt in Civic Trivia, trying to post in Civil Civics, navigating to the Connect section.

**Flow:**
1. User reads the Connect commitment — shared solutions, not tribal debate
2. User agrees and chooses a `display_name`
3. Identity verification (method TBD — see Open Questions)
4. Residency confirmation (state/district)
5. `connected_profiles` created with `verification_status: 'pending'`
6. Upon verification confirmation → `verification_status: 'verified'`
7. If user had anonymous compass in localStorage → import prompt

**Anonymous compass import:**
- Show user their previously saved topics/stances
- Confirm or update before saving to database
- Handle topic version mismatches gracefully (if a topic changed since they calibrated)
- Clear localStorage after successful import

**Abandonment handling:** Progress stored in `verification_sessions`, resumable. If user returns within session expiry window, they don't start over.

**Duplicate detection:** If verification signals an existing account, surface this gracefully without revealing any PII of the existing account.

---

### Journey 2: Connected → Empowered

**Entry points:** Completing full compass calibration and seeing an Empower prompt, attempting to use an Empower-only feature.

**Pre-flight checks (in order):**
1. Does user have `connected_profiles` with `verification_status: 'verified'`? No → redirect to Connect flow.
2. Is compass fully calibrated (all live `Top Priority` topics answered, filtered by role if applicable)? No → show calibration progress, prompt to complete.

**Empowerment commitment screen:**
- Explicitly state: *Your compass stances become public. Your display name becomes your legal name. This is the trade.*
- User enters `legal_name`
- User confirms they understand

**Atomic transaction:**
```
BEGIN;
  INSERT INTO empower.empowered_profiles (...);
  UPDATE inform.compass_responses
    SET visibility = 'public'
    WHERE user_id = $userId;
  UPDATE empower.empowered_profiles
    SET candidate_page_slug = generate_slug(legal_name)
    WHERE user_id = $userId;
COMMIT;
```

On any failure → full rollback. User remains Connected with no partial state.

**Demotion flow:**
```
BEGIN;
  UPDATE empower.empowered_profiles
    SET is_active = false WHERE user_id = $userId;
  UPDATE inform.compass_responses
    SET visibility = 'private' WHERE user_id = $userId;
COMMIT;
```

Candidate page deactivates. User returns to Connected tier. Reversible.

**Calibration lapse demotion:**
- New topic goes live → notify all Empowered Accounts
- 25-day mark → escalation warning
- 30-day mark without calibration → automatic demotion (same flow as voluntary demotion)
- User notified with specifics: which topic, how to recalibrate, how to restore Empowered status

---

## Suggested API Shape

```
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/logout

GET    /api/account/me                     # current user profile (tier-appropriate fields)
PATCH  /api/account/me                     # update display_name, preferences

POST   /api/connect/start                  # begin Connect flow, create verification_session
GET    /api/connect/status                 # check verification_status
POST   /api/connect/complete               # finalize connected_profile
POST   /api/connect/import-compass         # import anonymous localStorage calibration

GET    /api/compass                        # current user's compass responses
PUT    /api/compass/:topicId               # update a single response (logs change history)
GET    /api/compass/progress               # calibration completeness for empowerment check
GET    /api/compass/compare/:userId        # compare with another user (respects visibility)
GET    /api/compass/topics                 # all live topics, with stances

POST   /api/empower/preflight              # validate prerequisites, return what's missing
POST   /api/empower/confirm                # execute atomic empowerment transaction
POST   /api/empower/demote                 # return to Connected tier

POST   /api/connections/request/:userId
PATCH  /api/connections/:connectionId      # accept | decline | block
GET    /api/connections

POST   /api/follows/:userId
DELETE /api/follows/:userId
GET    /api/follows

GET    /api/candidates/:slug               # public Empowered Account candidate page

GET    /api/health
```

---

## Open Questions for Opus

These must be resolved before engineering begins.

### Identity Verification — Method
What service verifies that a user is who they say they are? Constraints:
- Privacy-preserving: we don't want to store government IDs
- Accessible: undocumented citizens and people without government IDs must be able to Connect. Civic participation is a human right, not contingent on documentation status.
- Scalable: must work beyond the Bloomington pilot
- Adaptable: "methods will need to constantly adapt as technology evolves"

Options explored: Stripe Identity, Persona, phone-carrier verification, manual process for pilot. No decision made yet.

### Uniqueness Constraint
How do we ensure one person = one account without storing SSNs or biometrics? Phone number? Is carrier-level verification sufficient? What happens when a user loses access to their verification credential?

### The Commitment Mechanism
The Connect commitment to "shared solutions" should feel meaningful, not like a terms-of-service checkbox. What does the interaction look like? A short quiz? A reading with a comprehension question? Something else? The design should feel like an earned threshold, not a barrier.

### Residency Verification
How do we confirm a user lives where they claim without requiring sensitive documents? Mail verification? Utility bill photo? Something lighter? What granularity is needed — state, district, zip code? How do we handle recent movers?

### Minor Voters
Users who are 17 but will turn 18 before election day are eligible voters in many jurisdictions. How does the verification flow handle near-18 users who may face different ID constraints than adults?

### Demotion & Public Record
When an Empowered user demotes back to Connected, their compass goes private. But what about the public record they created — posts in Symposiums, Empowered Bills they co-authored, positions they took on the Awareness Exchange? Options:
- Posts become pseudonymous (attributed to display_name, not legal_name)
- Posts remain attributed but compass goes private
- Posts are soft-deleted or hidden
This has significant implications for platform integrity and the "memory over moderation" principle. Needs a deliberate decision.

### Account Standing & Communal Councils
The Communal Council can suspend or quarantine users. How does this interact with `verification_status`? Is there a separate `account_standing` field? What can a suspended user still access? Can a suspended Connected user still see Inform features? (Probably yes — Inform is open to everyone.)

### Pilot Cohort Model
The Bloomington pilot may benefit from an invite or cohort model for early adopters. Does the accounts system need to support cohort assignment, invite codes, or access gating for the pilot phase? If so, what does that schema look like and when does it get removed?

### Compass: Weighting and Multi-Candidate Overlay
Future state questions that have schema implications:
- Should users be able to weight issues by importance? (Would require a `weight` field on `compass_responses`)
- Multi-candidate compass overlay (comparing yourself against 3+ candidates simultaneously) — does this require any schema changes or is it purely a rendering concern?

---

## What Success Looks Like

1. A user can move from anonymous → Connected → Empowered as a coherent progression that feels like earning civic trust, not filling out forms.
2. A Connected user's private compass data is never accidentally exposed — not through API, not through RLS gap, not through any surface.
3. The empowerment transaction is atomic — no partial states exist in the database.
4. An Empowered user's public candidate page accurately reflects their current stances at all times.
5. The system can answer "does this user have permission to do X?" with a join to the appropriate tier table — not a chain of flags, conditions, or application-layer guesses.
6. Identity verification is robust enough to prevent bot armies and sock puppet accounts without being so invasive that legitimate citizens without government ID are excluded.
7. The inversion preference on any compass spoke is respected everywhere that user's compass is rendered across the entire platform.

---

*Last updated: February 2026*
*Source documents: Empowered Essentials design doc, Empowered Compass design doc, Accounts design sessions*
*Document type: Pre-Alpha Design — intended for exploration with Opus before engineering begins*
