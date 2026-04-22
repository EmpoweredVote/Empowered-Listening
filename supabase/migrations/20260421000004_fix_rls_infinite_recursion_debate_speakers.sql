-- Fix infinite recursion in debate_speakers RLS policy.
-- All three policies referenced listening.debate_speakers while RLS is enabled
-- on that table, causing realtime.apply_rls() to recurse infinitely.
--
-- Fix: a SECURITY DEFINER helper runs as the function owner (bypasses RLS),
-- so the participant check never re-enters the policy evaluator.

CREATE OR REPLACE FUNCTION listening.current_user_is_participant(p_debate_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = listening, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id
      AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION listening.current_user_is_participant(uuid) TO anon, authenticated;

-- ============================================================
-- listening.debates
-- ============================================================
DROP POLICY IF EXISTS "debate_participants_can_read_scheduled" ON listening.debates;
CREATE POLICY "debate_participants_can_read_scheduled"
  ON listening.debates FOR SELECT
  TO authenticated, anon
  USING (
    status IN ('live', 'completed')
    OR listening.current_user_is_participant(id)
  );

-- ============================================================
-- listening.debate_segments
-- ============================================================
DROP POLICY IF EXISTS "debate_participants_can_read_segments" ON listening.debate_segments;
CREATE POLICY "debate_participants_can_read_segments"
  ON listening.debate_segments FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_segments.debate_id
        AND (
          d.status IN ('live', 'completed')
          OR listening.current_user_is_participant(d.id)
        )
    )
  );

-- ============================================================
-- listening.debate_speakers
-- ============================================================
DROP POLICY IF EXISTS "debate_participants_can_read_speakers" ON listening.debate_speakers;
CREATE POLICY "debate_participants_can_read_speakers"
  ON listening.debate_speakers FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_speakers.debate_id
        AND d.status IN ('live', 'completed')
    )
    OR listening.current_user_is_participant(debate_speakers.debate_id)
  );
