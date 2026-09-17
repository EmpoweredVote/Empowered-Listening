# Security handoff → Listening / Debates (Symposiums) team

**From:** Accounts/Essentials (Backend) · **Date:** 2026-06-17
**Project:** Supabase prod `E.V Backend` (ref `kxsdzaojfaibhuzmclfq`)
**Priority:** High — likely live IDOR on `listening.*` RPCs
**Owner action needed:** confirm how your app calls these functions, then apply a one-line fix (we can do it for you)

---

## TL;DR
While remediating a Supabase advisor "critical" finding (RLS disabled on public tables), we audited every `SECURITY DEFINER` function reachable through the PostgREST API. We found a systemic pattern where functions take a caller-supplied user/target id (`p_user_id`, `p_moderator_user_id`, …) but never check `auth.uid()`, so **any caller can act as/on any other user by passing their UUID**.

We fixed the 34 functions Accounts/Essentials owns. **8 functions in the `listening` schema are yours, and we did *not* touch them** — your app's call path is the deciding factor and we don't own that repo. This doc has everything you need to decide and fix.

## Why this matters for `listening`
All 8 `listening` SECURITY DEFINER functions are currently executable by **both `anon` and `authenticated`** — i.e. reachable by anyone with the public anon key, **including logged-out users**, via `POST /rest/v1/rpc/<fn>`. 7 of the 8 perform no `auth.uid()` ownership check.

| Function | anon | authenticated | checks `auth.uid()`? | risk if client-callable |
|---|:--:|:--:|:--:|---|
| `start_segment(uuid,uuid,uuid,integer)` | ✅ | ✅ | ❌ | start a segment as any moderator |
| `end_segment(uuid,uuid,uuid)` | ✅ | ✅ | ❌ | end a segment as any moderator |
| `repeat_segment(uuid,uuid,uuid,integer)` | ✅ | ✅ | ❌ | replay segment as any moderator |
| `start_prep_time(uuid,uuid,uuid,uuid,integer)` | ✅ | ✅ | ❌ | control prep timer for any speaker |
| `end_prep_time(uuid,uuid,uuid,uuid)` | ✅ | ✅ | ❌ | end prep timer for any speaker |
| `consume_bonus_time(uuid,integer)` | ✅ | ✅ | ❌ | drain any speaker's bonus time |
| `correct_transcript_entry(uuid,text,uuid,uuid)` | ✅ | ✅ | ❌ | rewrite transcript as any editor |
| `current_user_is_participant(uuid)` | ✅ | ✅ | ✅ | (already self-authorizes — see below) |

`current_user_is_participant` is the exception: it *does* use `auth.uid()`, so it's correctly self-authorizing — that's the model the others should follow if they're client-called.

## The one decision we need from you
**How does the Symposiums/debates app invoke these functions?**

- **Option A — through a trusted backend (service_role).** Your server verifies the user (JWT), then calls the RPC with the verified id via the `service_role` key. → The `anon`/`authenticated` grant is just the Postgres default and should be revoked. `service_role` bypasses the grant, so nothing breaks.
- **Option B — directly from the client** (`supabase.rpc(...)` with anon key + user JWT). → Each function needs an in-body `auth.uid()` ownership/role check; the grant must stay.

For reference, Accounts/Essentials verified Option A in our code (Express `adminRpc()` wraps every call with the service-role client), so revoking `authenticated` was safe for us.

## Remediation

### If Option A (server-side / service_role) — recommended if it matches
Revoke client access; `service_role` keeps working:
```sql
REVOKE EXECUTE ON FUNCTION listening.consume_bonus_time(uuid,integer)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.correct_transcript_entry(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.end_prep_time(uuid,uuid,uuid,uuid)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.end_segment(uuid,uuid,uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.repeat_segment(uuid,uuid,uuid,integer)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.start_prep_time(uuid,uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.start_segment(uuid,uuid,uuid,integer)       FROM PUBLIC, anon, authenticated;
-- Leave current_user_is_participant alone if it's used as an RLS/guard helper by client roles.
```

### If Option B (direct client calls)
Add an authorization check at the top of each function. **Do not** write `auth.uid() = p_user_id` blindly — if the function is *also* ever called by `service_role`, `auth.uid()` is `NULL` there and the guard would break that path. Use a guard that allows `service_role` and otherwise enforces identity/role, e.g.:
```sql
-- inside each function, right after BEGIN:
IF auth.role() IN ('anon','authenticated') THEN
  -- enforce the real rule, e.g. caller must be the moderator/participant:
  IF NOT listening.current_user_is_participant(p_debate_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING errcode = '42501';
  END IF;
END IF;
```
You already have `current_user_is_participant(uuid)` (uses `auth.uid()`) — reuse it as the gate.

## Note: default-privilege safeguard (your schema was excluded)
We set `ALTER DEFAULT PRIVILEGES` on Accounts/Essentials schemas so new functions are `service_role`-only by default (no silent `anon`/`authenticated` exposure). **We deliberately left `listening` untouched** so we wouldn't change your team's expectations. If you go with Option A, consider opting `listening` in:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA listening REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA listening GRANT  EXECUTE ON FUNCTIONS TO service_role;
```

## How to verify after you apply
```sql
SELECT p.oid::regprocedure::text AS func,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'listening' AND p.prosecdef
ORDER BY p.proname;
```

## Want us to do it?
If you confirm Option A, we'll apply the revoke migration for you and verify — just reply on the thread. If Option B, we can pair on the guard pattern. All of our changes are reversible (`GRANT EXECUTE … TO authenticated`).
