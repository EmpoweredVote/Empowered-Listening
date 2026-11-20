# Empowered Listening — working notes

Conventions that are not obvious from the code and that are expensive to get wrong. Keep this
short; if something needs a page, put it in `.planning/` and link it here.

Empowered Listening is the **Connect** pillar's debate infrastructure: two speakers and a
moderator run a timed Lincoln-Douglas debate, anyone can watch it live, every word is
transcribed and attributed, and the audience takes notes and votes. Identity, tiers and
location come from **ev-accounts** — this repo owns none of that, it reads it.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Zustand · `pg` ·
LiveKit (rooms + egress) · Mux (HLS) · Deepgram (transcription) · `@react-pdf/renderer` ·
`@dnd-kit` · `@empoweredvote/ev-ui`. Node 22 is pinned in `.node-version`.

🔴 **This is a Node web service, not a static site, and that is load-bearing.** The rest of the
platform has been folding its backends into the ev-accounts engine to kill always-on Render
services (Focused Communities, Civic Spaces slice assignment). Listening cannot follow: it holds
LiveKit rooms open, runs server-authoritative timers, keeps a Deepgram worker subscribed to live
audio tracks, and drives Mux egress. Request/reply consolidation does not fit any of that.

## The database is not reachable the way other EV apps reach it

🔴 **PostgREST only exposes the `public` schema, and this app's data is in `listening`.** So
`supabase.from('…')` does not work here. Every read and write goes through a route handler using
`getPool()` (`lib/db/pool.ts`), which connects as `postgres`, or through one of the
`SECURITY DEFINER` RPCs in `supabase/migrations/`.

🔴 **The service-role pool bypasses RLS, so a gate that lives only in a policy is not a gate.**
Put the condition in the SQL. `app/api/debates/[debateId]/stream` and `observer-snapshot` both
carry an explicit `AND status IN ('live','completed')` for exactly this reason — the policy
behind them is real but the pool never consults it.

🔴 **Client EXECUTE on the `listening` RPCs is revoked, on purpose** (migration
`20260617000000`). A June 2026 audit found them callable by `anon`/`authenticated` over
`POST /rest/v1/rpc/<fn>` while trusting a caller-supplied user id — an IDOR. They are invoked
server-side only. The one deliberate exception is
`listening.current_user_is_participant`, which RLS policies call during evaluation and which
must stay callable. Do not "fix" a permission error by granting EXECUTE back.

**Never run an unfiltered aggregate on the big tables in production.** This app shares the
`kxsdzaojfaibhuzmclfq` instance with Treasury Tracker, Essentials and Transparent Motivations,
on a small compute size with a daily Disk IO budget (ev-cto decision 0038).

🔴 **Name a migration after the version the apply assigned, not a round number.** Applying
through the Supabase API or the dashboard stamps the version at apply time, and
`supabase db push` matches local filenames against `supabase_migrations.schema_migrations` —
a file whose version is missing from that list reads as pending and is re-run. So the filename
follows the apply, not the other way round: `20261120150208_backfill_quoted_note_times.sql`.
Three older `listening` migrations still carry round numbers that do not match what is
deployed; all three are safe to re-run, which is why they have been left alone.

## Identity: two issuers, and the wrong one fails silently

🔴 **A member's id is NOT the token's `sub`.** Since the WorkOS AuthKit cutover (ev-accounts
decision 0002) two issuers are accepted. Supabase `sub` is the internal UUID; **WorkOS `sub` is a
WorkOS id (`user_01…`) and the internal UUID travels in `external_id`.** Every `listening` row is
keyed on the internal UUID.

| layer | what to use |
|---|---|
| route handlers | `verifyToken(bearer)` → `userId` (`lib/auth/jwks.ts`) — never read `sub` off the payload |
| client | `userIdFromToken(token)` (`lib/auth/user-id.ts`) — `external_id` first, then `sub` |

**A mismatch surfaces as missing data, not as an auth error.** `useUserRole` compares the client
id against `debate_speakers.user_id`; get it wrong and a speaker is silently classified as an
observer, loses their rebuttal checklist, and sees no error anywhere — while the server would
still accept their writes. That bug shipped once and is fixed; keep the two layers in step.

**The browser Supabase client is anon-key only** (`persistSession: false`, nothing calls
`realtime.setAuth()`), so `auth.uid()` is always null in the browser and the `auth.uid()`-based
RLS policies are dormant by design. If you ever hand that client a user token, those policies
need to resolve identity the issuer-aware way first, or they will match nothing.

🔴 **`ev_token` is this app's localStorage key.** Civic Spaces uses `cs_token` for the same JWT
from the same hub — copying a snippet across the two silently finds nothing.

## Debate rules that are fixed

**`lib/debate/segments.ts` is canonical.** Seven Lincoln-Douglas segments, 1920 speaking seconds
(32 min), plus `LD_PREP_TIME_SECONDS` of 4 minutes. Do not re-derive the schedule anywhere else;
display names are looked up from `LD_SEGMENTS`, not stored per row.

**Timers are server-authoritative.** Clients render, they never enforce. The target is under
200ms variance across connected clients, and the 4-state visual (normal / warning / red_mode /
expired) must look identical on every surface.

**Speaker and moderator UIs are desktop-only in v1.** `middleware.ts` matches `/join/:path*` and
sets an `x-mobile-gate: 1` header — it does not redirect, the gate renders inline on the same
page. Observers are not gated; `/debates/[debateId]` is fully anonymous and has no auth at all.

## Routes and runtime

**`export const runtime = 'nodejs'` is required** on any route importing `@livekit/rtc-node`
(native bindings), `pg`, or `@react-pdf/renderer`. Seven routes carry it today. Omitting it on a
new route that touches those gets you an edge-runtime failure at build or first request.

**`lib/env.ts` is fail-fast Zod** — a missing `MUX_TOKEN_ID` or `DEEPGRAM_API_KEY` refuses to
boot the server rather than failing at debate start. `WORKOS_ISSUER` and `WORKOS_JWKS_URL` are
deliberately *not* in that schema; they are read straight from `process.env`, so a typo in one
fails at verify time, not at boot.

## Known gaps — do not mistake these for bugs

- ✅ **The live Mux pipeline is verified** (2026-11-17). LiveKit egress → RTMP → Mux → HLS
  works end to end: Mux reported `active`, and `stream.mux.com/<playback_id>.m3u8` served four
  renditions up to 720p. The free plan was never the blocker — this note previously claimed it
  was. Still open: whether `latency_mode` should be `reduced` or `low`.
- 🔴 **An egress outlives its debate unless something stops it.** LiveKit will happily keep
  compositing an empty room and billing for it; one ran 6h18m here. `teardownDebateMedia`
  (`lib/debate/teardown.ts`) is the only correct way to release egress, the Mux stream and the
  transcription worker — call it from any new path that ends a debate, rather than stopping one
  of the three inline. `sweepOrphanedEgress` is the backstop, and runs whenever a segment starts.
- **There is no server-side segment auto-expire.** A client hook drives it today.
- **The bonus pool is not persisted.** It lives in memory for the life of the segment.
- **`/moderator/*` has no Next.js middleware gate.** The API is server-side protected on every
  route; the moderator UI gate is client-side only. Add the middleware before production.

## Planning

This repo uses the GSD workflow in `.planning/` — `ROADMAP.md` at the top, then
`phases/NN-name/` with `NN-RESEARCH.md`, `NN-MM-PLAN.md`, `NN-MM-SUMMARY.md` and
`NN-VERIFICATION.md`. **`STATE.md` is the accurate record of where things are**; the progress
table in `ROADMAP.md` has drifted before. Read the relevant phase's research and context docs
before changing an area — they record *why*, which is the expensive part to re-derive.

## Real data, current code

Volunteers and designers: build on live public data, never on invented data. Invented data in a
component becomes rework for whoever merges the PR.

- **Fetch through the existing hooks and route handlers.** Never type real-looking names,
  numbers, dates, quotes or IDs into a component, not even as placeholders. Interface copy is
  fine.
- **If a request fails, say so and stop.** Report the URL and status. Do not swap in invented
  data.
- **Data no API serves yet** goes in one module under `mocks/`, shaped like the response,
  starting with `// Stands in for: GET /api/<route> — not yet served by the API`. List it in the
  PR under "Data this needs from the API".
- Account and user data is off-limits for design work; mock signed-in states.
- **Start from current `master`:** `git fetch origin && git switch -c <branch> origin/master`.
  **The default branch is `master`; there is no `main`**, so `origin/main` fails. Work lands by
  PR, never by a direct push.
- Use `@empoweredvote/ev-ui` components instead of copying or restyling them.

🔴 **A local clone goes stale fast, and a stale snapshot is the most expensive mistake available
here.** Committing an old working directory onto current `master` produces no conflicts and
silently reverts other people's fixes. Branch from `origin/master` every time; if you have been
away, rebase and handle conflicts *as conflicts*.

## CI

One workflow, `.github/workflows/ci.yml`, job name `build`: `npm ci`, `npm run lint`,
`npm test`, `npm run build`. All four must pass. Dependabot patch and minor updates auto-merge.

🔴 **A `package-lock.json` regenerated on Windows fails CI.** `npm install` and `npm update`
here drop the hoisted `@emnapi/runtime` that `@img/sharp-wasm32` needs — Windows never selects
that optional sharp binary — and the Linux runner then refuses the tree with `Missing:
@emnapi/runtime@… from lock file`. A local `npm ci` passes, being the same platform, so the
lockfile looks clean right up until the push. Take dependency bumps from Dependabot PRs, which
are generated on Linux; by hand, generate the lockfile in WSL or a container. Hit on
2026-11-20 clearing Dependabot alert 52.

## Render settings live in ev-infra

This repo's Render service is managed by the Render Blueprint in
[`EmpoweredVote/ev-infra`](https://github.com/EmpoweredVote/ev-infra) (`render.yaml`).

- Build and start commands, rewrites, headers, custom domains, plans, cron
  schedules and build filters change **only through a PR to ev-infra**. Render
  syncs its `main` branch automatically.
- A setting changed in the Render dashboard is **undone on the next sync**.
- Env var **values** are the exception: set them in the Render dashboard. Add a
  new variable's name to ev-infra (with `sync: false`) so the record stays complete.
- Do not add a `render.yaml` to this repo. Render does not read it.
