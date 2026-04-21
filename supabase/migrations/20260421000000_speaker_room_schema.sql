-- Migration: Phase 2 speaker room schema additions + Realtime enablement + participant-visibility RLS
-- Phase: 02-speaker-room / Plan: 02-01

-- ============================================================
-- 1. Column additions
-- ============================================================

ALTER TABLE listening.debate_segments
  ADD COLUMN IF NOT EXISTS end_time timestamptz;

ALTER TABLE listening.debate_segments
  ADD COLUMN IF NOT EXISTS prep_time_end_time timestamptz;

ALTER TABLE listening.debate_segments
  ADD COLUMN IF NOT EXISTS paused_remaining_seconds integer;

ALTER TABLE listening.debate_speakers
  ADD COLUMN IF NOT EXISTS prep_time_seconds integer NOT NULL DEFAULT 240;

-- ============================================================
-- 2. Realtime enablement for Phase 2 subscriptions
-- ============================================================

GRANT SELECT ON listening.debates TO authenticated;
GRANT SELECT ON listening.debate_segments TO authenticated;
GRANT SELECT ON listening.debate_speakers TO authenticated;

ALTER TABLE listening.debates REPLICA IDENTITY FULL;
ALTER TABLE listening.debate_segments REPLICA IDENTITY FULL;
ALTER TABLE listening.debate_speakers REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE listening.debates;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already in publication, safe to skip
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE listening.debate_segments;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already in publication, safe to skip
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE listening.debate_speakers;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already in publication, safe to skip
END;
$$;

-- ============================================================
-- 3. RLS amendments — participant visibility for scheduled debates
-- ============================================================

-- debates: replace public-only policy with one that also allows participants of scheduled debates
DROP POLICY IF EXISTS "debates_select_public" ON listening.debates;
DROP POLICY IF EXISTS "debate_participants_can_read_scheduled" ON listening.debates;
CREATE POLICY "debate_participants_can_read_scheduled"
  ON listening.debates FOR SELECT
  TO authenticated
  USING (
    status IN ('live', 'completed')
    OR EXISTS (
      SELECT 1 FROM listening.debate_speakers
      WHERE debate_id = debates.id AND user_id = (select auth.uid())
    )
  );

-- debate_segments: replace public-only policy with participant-aware policy
DROP POLICY IF EXISTS "debate_segments_select_public" ON listening.debate_segments;
DROP POLICY IF EXISTS "debate_participants_can_read_segments" ON listening.debate_segments;
CREATE POLICY "debate_participants_can_read_segments"
  ON listening.debate_segments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_segments.debate_id
        AND (
          d.status IN ('live', 'completed')
          OR EXISTS (
            SELECT 1 FROM listening.debate_speakers ds
            WHERE ds.debate_id = d.id AND ds.user_id = (select auth.uid())
          )
        )
    )
  );

-- debate_speakers: replace public-only policy with participant-aware policy
DROP POLICY IF EXISTS "debate_speakers_select_public" ON listening.debate_speakers;
DROP POLICY IF EXISTS "debate_participants_can_read_speakers" ON listening.debate_speakers;
CREATE POLICY "debate_participants_can_read_speakers"
  ON listening.debate_speakers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_speakers.debate_id
        AND (
          d.status IN ('live', 'completed')
          OR EXISTS (
            SELECT 1 FROM listening.debate_speakers ds2
            WHERE ds2.debate_id = d.id AND ds2.user_id = (select auth.uid())
          )
        )
    )
  );
