-- ============================================================
-- end_segment: actually spend the speaker's bonus pool,
-- and repeat_segment: give it back when the take is discarded
-- ============================================================
--
-- The 60-second bonus pool has never depleted. `listening.consume_bonus_time`
-- was written in Phase 2 and the TS wrapper `consumeBonusTime` sits in
-- lib/debate/transitions.ts, but nothing has ever called either one, and
-- `debate_segments.bonus_seconds_used` was reset to 0 by repeat_segment and
-- otherwise never written. So a speaker who burned all 60 seconds in segment 1
-- started segment 2 with a fresh 60.
--
-- That makes Phase 2's success criterion 5 ("each speaker's 60-second bonus
-- pool ... the mic is auto-muted when the pool reaches zero") only half true:
-- the pool activates, but it is not a pool, it is a per-segment allowance.
--
-- Accounting belongs here rather than in the route because it has to be atomic
-- with the status transition. Two things can end a segment — the moderator's
-- tab and (shortly) a server-side expiry timer — and the pool must be charged
-- exactly once no matter how many callers race.
--
-- Deliberately NOT charged:
--   * a segment that is already 'completed' — the charge happens only on the
--     transition out of 'active', so a duplicate or retried call is free
--   * a segment with no speaker (CX, moderator-run segments)
--   * a segment ended early, before end_time — there is no overrun to charge
--   * a segment paused for prep time, where end_time is not a live deadline
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
  v_segment  listening.debate_segments;
  v_prior    listening.debate_segments;
  v_overrun  integer;
  v_pool     integer;
  v_used     integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  -- Lock the row first: this is what makes the charge race-safe.
  SELECT * INTO v_prior
  FROM listening.debate_segments
  WHERE id = p_segment_id AND debate_id = p_debate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Segment not found for debate %', p_debate_id;
  END IF;

  IF v_prior.status = 'active'
     AND v_prior.speaker_id IS NOT NULL
     AND v_prior.end_time IS NOT NULL
     AND v_prior.paused_remaining_seconds IS NULL
     AND NOW() > v_prior.end_time
  THEN
    v_overrun := CEIL(EXTRACT(EPOCH FROM (NOW() - v_prior.end_time)))::integer;

    SELECT bonus_time_seconds INTO v_pool
    FROM listening.debate_speakers
    WHERE id = v_prior.speaker_id
    FOR UPDATE;

    -- Never charge more than the speaker had. An overrun beyond the pool means
    -- the segment ran long for some other reason (a slow end call, a stalled
    -- moderator tab) and is not the speaker's to pay for.
    v_used := LEAST(v_overrun, GREATEST(COALESCE(v_pool, 0), 0));

    IF v_used > 0 THEN
      UPDATE listening.debate_speakers
      SET bonus_time_seconds = GREATEST(0, bonus_time_seconds - v_used)
      WHERE id = v_prior.speaker_id;
    END IF;
  END IF;

  UPDATE listening.debate_segments
  SET status = 'completed',
      actual_end = NOW(),
      bonus_seconds_used =
        CASE WHEN v_prior.status = 'active' THEN v_used ELSE bonus_seconds_used END
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

-- Client EXECUTE stays revoked (migration 20260617000000, June 2026 IDOR audit).
-- CREATE OR REPLACE preserves existing grants, so nothing is re-granted here.

-- ============================================================
-- repeat_segment: give the pool back when the take is thrown away
-- ============================================================
--
-- repeat_segment already resets the segment's bonus_seconds_used to 0, which
-- says plainly what a repeat means: the take is discarded and its accounting
-- with it. Now that end_segment actually spends the pool, resetting only the
-- counter would leave the two halves disagreeing — the segment would read as
-- having used no bonus while the speaker stayed charged for it, permanently,
-- for a take nobody kept.
--
-- The counter is the ledger for exactly one charge, so refunding it and
-- clearing it in the same call can never pay twice: a second repeat with no
-- intervening end finds 0 to refund. The pool therefore cannot climb above
-- where it started.
--
-- Not-found behaviour is deliberately unchanged: no row means no refund and
-- an UPDATE that matches nothing, exactly as before.
-- ============================================================

CREATE OR REPLACE FUNCTION listening.repeat_segment(
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
  v_segment    listening.debate_segments;
  v_end_time   timestamptz;
  v_refund     integer;
  v_speaker_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  -- Same lock order as end_segment — segment first, then speaker — so a
  -- repeat and an end racing on one segment cannot deadlock.
  SELECT bonus_seconds_used, speaker_id INTO v_refund, v_speaker_id
  FROM listening.debate_segments
  WHERE id = p_segment_id AND debate_id = p_debate_id
  FOR UPDATE;

  IF COALESCE(v_refund, 0) > 0 AND v_speaker_id IS NOT NULL THEN
    UPDATE listening.debate_speakers
    SET bonus_time_seconds = bonus_time_seconds + v_refund
    WHERE id = v_speaker_id;
  END IF;

  v_end_time := NOW() + (p_duration_seconds || ' seconds')::interval;

  UPDATE listening.debate_segments
  SET status = 'active', actual_start = NOW(), end_time = v_end_time,
      prep_time_end_time = NULL, paused_remaining_seconds = NULL, bonus_seconds_used = 0
  WHERE id = p_segment_id AND debate_id = p_debate_id
  RETURNING * INTO v_segment;

  RETURN v_segment;
END;
$$;
