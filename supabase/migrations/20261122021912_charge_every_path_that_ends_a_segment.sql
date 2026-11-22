-- ============================================================
-- One place that charges the bonus pool, called from every path
-- that stops a segment's clock
-- ============================================================
--
-- A code review of the bonus-pool work (PR #75) and of server-side expiry
-- (PR #76) found three holes in "the pool is charged exactly once, no matter
-- who ends the segment". All three come from the same cause: `end_segment`
-- was not the only thing that stops a segment's clock, and it was the only
-- thing that charged.
--
--   1. `start_segment` completes any still-active segment inline
--      (`SET status = 'completed' ... WHERE status = 'active'`) and charged
--      nothing. Reachable after a `repeat_segment`, which puts segment k back
--      to 'active' and so drops MAX(sequence_order WHERE completed) to k-1 —
--      at which point `start_segment(k)` passes the sequence check and
--      silently completes the overrunning take for free.
--
--   2. Prep taken *during* an overrun handed the pool back. `start_prep_time`
--      snapshots `GREATEST(0, end_time - NOW())`, which is 0 once end_time has
--      passed, and nulls end_time. `end_prep_time` then restores
--      `end_time = NOW() + 0`, so the segment resumes with its clock at zero
--      and a *full*, unspent pool — a second complete bonus window, every time
--      a speaker took prep after the buzzer. The pool had already been earned
--      away; nothing had charged it yet, because only `end_segment` charges.
--
--   3. `bonus_seconds_used` was assigned rather than accumulated, so a segment
--      charged more than once recorded only the last charge. Harmless while
--      there was one charge point; wrong as soon as there are three.
--
-- The fix is to stop spreading the rule. `charge_segment_overrun` holds it
-- once, and the three paths that stop a clock call it. `repeat_segment` is
-- unchanged in shape — it still refunds `bonus_seconds_used` and zeroes it —
-- but that total now includes a prep-time charge, which is right: a discarded
-- take costs the speaker nothing, however its clock was stopped.
--
-- The invariant across any sequence of charges and repeats is unchanged:
--   bonus_time_seconds + SUM(bonus_seconds_used for live segments) = 60
-- because every charge is clamped to the pool read under the speaker's row
-- lock, and every refund is bounded by the counter it then zeroes.
-- ============================================================

-- ============================================================
-- charge_segment_overrun — the rule, in one place
-- ============================================================
--
-- Returns the seconds charged, which the caller adds to the segment's
-- `bonus_seconds_used`. Returns 0 — and charges nothing — for every case the
-- original deliberately excluded:
--
--   * a segment that is not 'active': the charge belongs to the transition out
--     of 'active', so a duplicate or retried call is free
--   * a segment with no speaker (CX, moderator-run): nobody's pool to draw on
--   * a segment with no end_time, or paused for prep: no live deadline, so no
--     overrun to speak of
--   * a segment still inside its clock: nothing has been overrun
--
-- On the clamp, which the review flagged as contradicting its own comment: the
-- old comment claimed an overrun beyond the pool "is not the speaker's to pay
-- for", while `LEAST` charged the whole pool in exactly that case. The clamp is
-- the right behaviour and the comment was wrong. The pool *is* the whole of the
-- grace a speaker gets, so an overrun past it means all of it was spent; and
-- the alternative — charging nothing once the overrun exceeds the pool — would
-- reward a longer overrun and put a cliff at the boundary, where 60s costs
-- everything and 61s costs nothing.
--
-- What an overrun far past the pool really means is that nothing stopped the
-- segment: expiry gave up, or was switched off, or the process restarted at the
-- wrong moment. That is worth saying out loud rather than silently charging, so
-- it raises a WARNING. It is not worth changing the charge, because no amount of
-- arithmetic here can tell a speaker who talked through a stall from one who sat
-- in silence during it.
-- ============================================================

CREATE OR REPLACE FUNCTION listening.charge_segment_overrun(p_segment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior   listening.debate_segments;
  v_overrun integer;
  v_pool    integer;
  v_used    integer := 0;
BEGIN
  -- Segment first, then speaker. Every caller takes the locks in this order,
  -- so two of them racing on one segment cannot deadlock.
  SELECT * INTO v_prior
  FROM listening.debate_segments
  WHERE id = p_segment_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_prior.status <> 'active'
     OR v_prior.speaker_id IS NULL
     OR v_prior.end_time IS NULL
     OR v_prior.paused_remaining_seconds IS NOT NULL
     OR NOW() <= v_prior.end_time
  THEN
    RETURN 0;
  END IF;

  v_overrun := CEIL(EXTRACT(EPOCH FROM (NOW() - v_prior.end_time)))::integer;

  SELECT bonus_time_seconds INTO v_pool
  FROM listening.debate_speakers
  WHERE id = v_prior.speaker_id
  FOR UPDATE;

  v_used := LEAST(v_overrun, GREATEST(COALESCE(v_pool, 0), 0));

  -- 30s of slack for the end call's own latency and for clock skew. Past that,
  -- something was supposed to stop this segment and did not.
  IF v_overrun > COALESCE(v_pool, 0) + 30 THEN
    RAISE WARNING '[bonus] segment % overran its pool by % seconds — nothing stopped it; charged % of a % second pool',
      p_segment_id, v_overrun - COALESCE(v_pool, 0), v_used, COALESCE(v_pool, 0);
  END IF;

  IF v_used > 0 THEN
    UPDATE listening.debate_speakers
    SET bonus_time_seconds = GREATEST(0, bonus_time_seconds - v_used)
    WHERE id = v_prior.speaker_id;
  END IF;

  RETURN v_used;
END;
$$;

-- service_role included: a default-privileges grant in this schema hands it
-- EXECUTE on a newly created function, and every sibling RPC here is revoked
-- from it. The app connects as `postgres`, not service_role, so this changes
-- nothing for the application and keeps the new function in line with the
-- ones it sits beside.
REVOKE EXECUTE ON FUNCTION listening.charge_segment_overrun(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- end_segment — now charges through the shared rule, and accumulates
-- ============================================================

CREATE OR REPLACE FUNCTION listening.end_segment(
  p_debate_id uuid,
  p_segment_id uuid,
  p_moderator_user_id uuid
)
RETURNS listening.debate_segments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_segment listening.debate_segments;
  v_prior   listening.debate_segments;
  v_used    integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  SELECT * INTO v_prior
  FROM listening.debate_segments
  WHERE id = p_segment_id AND debate_id = p_debate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Segment not found for debate %', p_debate_id;
  END IF;

  v_used := listening.charge_segment_overrun(p_segment_id);

  UPDATE listening.debate_segments
  SET status = 'completed',
      actual_end = NOW(),
      -- Accumulated, not assigned: a segment can be charged once when prep
      -- starts and again when it ends, and the counter is what a repeat
      -- refunds, so it has to hold the whole of what this take cost.
      bonus_seconds_used =
        CASE WHEN v_prior.status = 'active'
             THEN COALESCE(bonus_seconds_used, 0) + v_used
             ELSE bonus_seconds_used END
  WHERE id = p_segment_id AND debate_id = p_debate_id
  RETURNING * INTO v_segment;

  -- If this was the last segment, mark debate completed
  IF v_segment.sequence_order = (
    SELECT MAX(sequence_order) FROM listening.debate_segments WHERE debate_id = p_debate_id
  ) THEN
    UPDATE listening.debates SET status = 'completed', end_time = NOW() WHERE id = p_debate_id;
  END IF;

  RETURN v_segment;
END;
$$;

-- ============================================================
-- start_segment — charge the segment this start implicitly ends
-- ============================================================
--
-- Only the inline "mark any currently active segment completed" changes: it
-- now charges each one it closes, through the same rule. Everything else —
-- the moderator check, the sequence enforcement, the debate transition — is
-- the deployed function unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION listening.start_segment(
  p_debate_id uuid,
  p_segment_id uuid,
  p_moderator_user_id uuid,
  p_duration_seconds integer
)
RETURNS listening.debate_segments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_segment       listening.debate_segments;
  v_end_time      timestamptz;
  v_target_order  integer;
  v_max_completed integer;
  v_active        record;
  v_used          integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  SELECT sequence_order INTO v_target_order
  FROM listening.debate_segments
  WHERE id = p_segment_id AND debate_id = p_debate_id;

  IF v_target_order IS NULL THEN
    RAISE EXCEPTION 'Segment % not found for debate %', p_segment_id, p_debate_id;
  END IF;

  SELECT COALESCE(MAX(sequence_order), 0) INTO v_max_completed
  FROM listening.debate_segments
  WHERE debate_id = p_debate_id AND status = 'completed';

  IF NOT (
    (v_target_order = 1 AND v_max_completed = 0)
    OR (v_target_order = v_max_completed + 1)
  ) THEN
    RAISE EXCEPTION 'Invalid sequence: cannot start segment % out of order (max completed = %)',
      v_target_order, v_max_completed;
  END IF;

  v_end_time := NOW() + (p_duration_seconds || ' seconds')::interval;

  -- Mark any currently active segment completed — and charge it. Starting the
  -- next segment stops the previous one's clock just as surely as ending it
  -- does, and before this it did so for free.
  FOR v_active IN
    SELECT id FROM listening.debate_segments
    WHERE debate_id = p_debate_id AND status = 'active'
    ORDER BY sequence_order
  LOOP
    v_used := listening.charge_segment_overrun(v_active.id);
    UPDATE listening.debate_segments
    SET status = 'completed',
        actual_end = NOW(),
        bonus_seconds_used = COALESCE(bonus_seconds_used, 0) + v_used
    WHERE id = v_active.id;
  END LOOP;

  UPDATE listening.debate_segments
  SET status = 'active', actual_start = NOW(), end_time = v_end_time,
      prep_time_end_time = NULL, paused_remaining_seconds = NULL
  WHERE id = p_segment_id
  RETURNING * INTO v_segment;

  UPDATE listening.debates
  SET status = 'live', actual_start = COALESCE(actual_start, NOW())
  WHERE id = p_debate_id;

  RETURN v_segment;
END;
$$;

-- ============================================================
-- start_prep_time — charge the overrun before pausing the clock
-- ============================================================
--
-- This is the one with teeth. Prep taken after the buzzer snapshots
-- `GREATEST(0, end_time - NOW())` = 0 and nulls end_time; prep-end then sets
-- `end_time = NOW()`, and the segment resumes on a zeroed clock with a pool
-- that was never charged. Server-side expiry re-arms from that pool, so the
-- speaker gets a second full bonus window — and a third, if they take prep
-- again. Charging here closes it: by the time the clock is paused, the bonus
-- already spent has been paid for, and what resumes is only what is left.
--
-- Everything else is the deployed function unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION listening.start_prep_time(
  p_debate_id uuid,
  p_segment_id uuid,
  p_speaker_id uuid,
  p_caller_user_id uuid,
  p_prep_seconds integer
)
RETURNS TABLE(segment listening.debate_segments, prep_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_segment           listening.debate_segments;
  v_pool              integer;
  v_remaining_seconds integer;
  v_prep_end          timestamptz;
  v_used              integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_caller_user_id
      AND (role = 'moderator' OR id = p_speaker_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the moderator or the target speaker';
  END IF;

  SELECT prep_time_seconds INTO v_pool
  FROM listening.debate_speakers WHERE id = p_speaker_id;

  IF v_pool IS NULL OR v_pool <= 0 THEN
    RAISE EXCEPTION 'Speaker has no prep time remaining';
  END IF;

  SELECT * INTO v_segment FROM listening.debate_segments WHERE id = p_segment_id;
  IF v_segment IS NULL THEN
    RAISE EXCEPTION 'Segment % not found', p_segment_id;
  END IF;
  IF v_segment.status != 'active' OR v_segment.end_time IS NULL THEN
    RAISE EXCEPTION 'Cannot start prep: segment is not currently active';
  END IF;

  -- Charged before the clock is paused, while the segment is still 'active'
  -- and still carries the end_time the overrun is measured from.
  v_used := listening.charge_segment_overrun(p_segment_id);

  v_remaining_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_segment.end_time - NOW()))::integer);
  v_prep_end := NOW() + (LEAST(p_prep_seconds, v_pool) || ' seconds')::interval;

  UPDATE listening.debate_segments
  SET paused_remaining_seconds = v_remaining_seconds,
      end_time = NULL,
      prep_time_end_time = v_prep_end,
      status = 'paused',
      bonus_seconds_used = COALESCE(bonus_seconds_used, 0) + v_used
  WHERE id = p_segment_id
  RETURNING * INTO v_segment;

  RETURN QUERY SELECT v_segment, v_pool;
END;
$$;

-- Client EXECUTE stays revoked for all of these (migration 20260617000000,
-- June 2026 IDOR audit). CREATE OR REPLACE preserves existing grants, so
-- nothing is re-granted here; the new function is revoked explicitly above.
