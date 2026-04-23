-- Migration: Phase 4 — SECURITY DEFINER RPC for moderator transcript correction
-- Phase: 04-transcription / Plan: 04-04
-- Depends on: 20260423000000 (original_text column already added)

CREATE OR REPLACE FUNCTION listening.correct_transcript_entry(
  p_entry_id     uuid,
  p_new_text     text,
  p_editor_user_id uuid,
  p_debate_id    uuid
)
RETURNS listening.transcript_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry listening.transcript_entries;
BEGIN
  -- Verify caller is the debate moderator
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id
      AND user_id = p_editor_user_id
      AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  -- Verify debate is completed (no live editing allowed)
  IF NOT EXISTS (
    SELECT 1 FROM listening.debates
    WHERE id = p_debate_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Cannot edit transcript of an active or scheduled debate';
  END IF;

  -- Update entry: store original text on first edit only; set edit metadata
  UPDATE listening.transcript_entries
  SET
    original_text = CASE WHEN edited = false THEN text ELSE original_text END,
    text          = p_new_text,
    edited        = true,
    edited_at     = NOW(),
    edited_by     = p_editor_user_id
  WHERE id = p_entry_id
    AND debate_id = p_debate_id
  RETURNING * INTO v_entry;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transcript entry not found';
  END IF;

  RETURN v_entry;
END;
$$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION listening.correct_transcript_entry(uuid, text, uuid, uuid)
  TO authenticated;
