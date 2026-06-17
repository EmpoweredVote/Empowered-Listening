-- Security: revoke client (anon/authenticated) EXECUTE on listening SECURITY DEFINER RPCs.
--
-- Context: Accounts/Essentials security audit (2026-06-17, handoff doc) found these
-- SECURITY DEFINER functions were executable by anon + authenticated via PostgREST
-- (POST /rest/v1/rpc/<fn>) while trusting a caller-supplied user id and performing no
-- auth.uid() check -> IDOR (act as/on any user with their UUID).
--
-- Decision: Option A (trusted backend). The Symposiums/debates app never calls these
-- from the client. They are invoked exclusively server-side via lib/debate/transitions.ts
-- and app/api/.../transcript/[entryId]/route.ts using a direct pg pool that connects as
-- the `postgres` role. `postgres` owns these functions and keeps EXECUTE regardless of
-- the grant below, so revoking client access does not affect the app. The API layer
-- verifies the JWT (requireModeratorFromRequest) and passes the verified id.
--
-- NOTE: listening.current_user_is_participant is intentionally NOT revoked. It is used
-- inside RLS policy USING clauses (see 20260421000004) and must remain callable by
-- anon/authenticated during policy evaluation.

REVOKE EXECUTE ON FUNCTION listening.consume_bonus_time(uuid,integer)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.correct_transcript_entry(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.end_prep_time(uuid,uuid,uuid,uuid)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.end_segment(uuid,uuid,uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.repeat_segment(uuid,uuid,uuid,integer)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.start_prep_time(uuid,uuid,uuid,uuid,integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION listening.start_segment(uuid,uuid,uuid,integer)         FROM PUBLIC, anon, authenticated;

-- Default-privilege safeguard: new listening functions are service_role-only by default
-- (no silent anon/authenticated exposure). Mirrors what Accounts/Essentials applied to
-- their schemas.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA listening REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA listening GRANT  EXECUTE ON FUNCTIONS TO service_role;
