-- Close out the April 2026 test debates that were left in 'live'.
--
-- Fifteen debates from the Phase 2/3 end-to-end sittings (2026-04-21 to 04-23)
-- are still status = 'live' seven months on.  A debate only reaches 'completed'
-- when its last segment ends, so closing the moderator tab mid-run stranded
-- them.  Eleven of them also still hold a segment in status = 'active', with an
-- end_time long past.
--
-- Two reasons this is worth cleaning rather than leaving:
--
--   1. 'live' is what `app/api/debates/[debateId]/stream` and `observer-snapshot`
--      check to decide what an anonymous visitor may read.  These are scratch
--      debates ("dsafa", "Who dis?"), not civic record, and they should not sit
--      in the set that reads as publicly viewable.
--
--   2. The server-side segment expiry sweep re-arms a timer for every segment
--      where status = 'active' AND the debate is 'live'.  Left as they are,
--      these eleven would each fire a full segment-end flow on the next boot
--      after that lands — mic revokes and egress teardown against debates that
--      ended in April.
--
-- Scope is fenced by date and by emptiness: only debates that started before
-- 2026-05-01 and never recorded a single transcript line.  Nothing with content
-- is touched, and the migration is a no-op on any database that lacks these
-- rows (a fresh local stack, for instance).

BEGIN;

-- Segments first: the debate-level filter still reads 'live' at this point.
UPDATE listening.debate_segments s
   SET status = 'completed'
  FROM listening.debates d
 WHERE d.id = s.debate_id
   AND s.status IN ('active', 'paused')
   AND d.status = 'live'
   AND d.actual_start < TIMESTAMPTZ '2026-05-01'
   AND NOT EXISTS (
         SELECT 1 FROM listening.transcript_entries t WHERE t.debate_id = d.id
       );

UPDATE listening.debates d
   SET status = 'cancelled'
 WHERE d.status = 'live'
   AND d.actual_start < TIMESTAMPTZ '2026-05-01'
   AND NOT EXISTS (
         SELECT 1 FROM listening.transcript_entries t WHERE t.debate_id = d.id
       );

COMMIT;
