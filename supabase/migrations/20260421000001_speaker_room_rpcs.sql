-- Migration: Phase 2 speaker room state-transition RPCs
-- Phase: 02-speaker-room / Plan: 02-01

-- ============================================================
-- 1. start_segment — activate a segment, set end_time, transition debate to live
--    ENFORCES FIXED SEQUENCE ORDER (DEBATE-04)
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
  v_segment listening.debate_segments;
  v_end_time timestamptz;
  v_target_order integer;
  v_max_completed integer;
BEGIN
  -- Moderator identity check
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  -- Enforce fixed sequence order
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

  -- Mark any currently active segment completed
  UPDATE listening.debate_segments
  SET status = 'completed', actual_end = NOW()
  WHERE debate_id = p_debate_id AND status = 'active';

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
-- 2. end_segment
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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  UPDATE listening.debate_segments
  SET status = 'completed', actual_end = NOW()
  WHERE id = p_segment_id AND debate_id = p_debate_id
  RETURNING * INTO v_segment;

  IF v_segment IS NULL THEN
    RAISE EXCEPTION 'Segment not found for debate %', p_debate_id;
  END IF;

  -- If this was the last segment, mark debate completed
  IF v_segment.sequence_order = (SELECT MAX(sequence_order) FROM listening.debate_segments WHERE debate_id = p_debate_id) THEN
    UPDATE listening.debates SET status = 'completed', end_time = NOW() WHERE id = p_debate_id;
  END IF;

  RETURN v_segment;
END;
$$;

-- ============================================================
-- 3. repeat_segment — full reset (not resume), exempt from sequence enforcement
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
  v_segment listening.debate_segments;
  v_end_time timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
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

-- ============================================================
-- 4. start_prep_time — pause main timer, snapshot remaining seconds
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
  v_segment listening.debate_segments;
  v_pool integer;
  v_remaining_seconds integer;
  v_prep_end timestamptz;
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

  v_remaining_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_segment.end_time - NOW()))::integer);
  v_prep_end := NOW() + (LEAST(p_prep_seconds, v_pool) || ' seconds')::interval;

  UPDATE listening.debate_segments
  SET paused_remaining_seconds = v_remaining_seconds,
      end_time = NULL,
      prep_time_end_time = v_prep_end,
      status = 'paused'
  WHERE id = p_segment_id
  RETURNING * INTO v_segment;

  RETURN QUERY SELECT v_segment, v_pool;
END;
$$;

-- ============================================================
-- 5. end_prep_time — restore end_time from paused_remaining_seconds (faithful resume)
-- ============================================================
CREATE OR REPLACE FUNCTION listening.end_prep_time(
  p_debate_id uuid,
  p_segment_id uuid,
  p_speaker_id uuid,
  p_caller_user_id uuid
)
RETURNS listening.debate_segments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_segment listening.debate_segments;
  v_new_end timestamptz;
  v_prep_seconds_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_caller_user_id
      AND (role = 'moderator' OR id = p_speaker_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_segment FROM listening.debate_segments WHERE id = p_segment_id;
  IF v_segment.status != 'paused' OR v_segment.prep_time_end_time IS NULL THEN
    RAISE EXCEPTION 'Segment is not currently in prep-pause state';
  END IF;
  IF v_segment.paused_remaining_seconds IS NULL THEN
    RAISE EXCEPTION 'Segment has no paused_remaining_seconds snapshot — cannot resume';
  END IF;

  -- Faithful restore: use snapshot, NOT allocated_seconds
  v_new_end := NOW() + (v_segment.paused_remaining_seconds || ' seconds')::interval;

  -- Approximate prep seconds used (v1: bounded by pool, safe side)
  IF NOW() >= v_segment.prep_time_end_time THEN
    -- Prep ran to natural end — estimate used as pool consumed
    v_prep_seconds_used := GREATEST(0,
      EXTRACT(EPOCH FROM (v_segment.prep_time_end_time - NOW() + (v_segment.paused_remaining_seconds || ' seconds')::interval))::integer
    );
  ELSE
    -- Early stop — conservative: track 0 to avoid over-decrement
    v_prep_seconds_used := 0;
  END IF;

  UPDATE listening.debate_segments
  SET end_time = v_new_end,
      prep_time_end_time = NULL,
      paused_remaining_seconds = NULL,
      status = 'active'
  WHERE id = p_segment_id
  RETURNING * INTO v_segment;

  UPDATE listening.debate_speakers
  SET prep_time_seconds = GREATEST(0, prep_time_seconds - v_prep_seconds_used)
  WHERE id = p_speaker_id;

  RETURN v_segment;
END;
$$;

-- ============================================================
-- 6. consume_bonus_time — decrement speaker bonus pool
-- ============================================================
CREATE OR REPLACE FUNCTION listening.consume_bonus_time(
  p_speaker_id uuid,
  p_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_pool integer;
BEGIN
  UPDATE listening.debate_speakers
  SET bonus_time_seconds = GREATEST(0, bonus_time_seconds - p_seconds)
  WHERE id = p_speaker_id
  RETURNING bonus_time_seconds INTO v_new_pool;
  RETURN v_new_pool;
END;
$$;

-- Grant execute on all RPCs to authenticated
GRANT EXECUTE ON FUNCTION listening.start_segment(uuid, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION listening.end_segment(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION listening.repeat_segment(uuid, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION listening.start_prep_time(uuid, uuid, uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION listening.end_prep_time(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION listening.consume_bonus_time(uuid, integer) TO authenticated;
