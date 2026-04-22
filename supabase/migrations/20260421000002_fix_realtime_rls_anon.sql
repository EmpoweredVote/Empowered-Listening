-- Fix: re-add anon role to listening schema RLS SELECT policies.
--
-- The 20260421000000 migration changed policies from TO authenticated, anon
-- to TO authenticated only.  Supabase Realtime validates JWTs against the
-- project's own secret/JWKS; the ev_token (ES256, external issuer) is not
-- recognised, so Realtime connections fall back to role=anon.  With anon
-- excluded, no postgres_changes events are delivered → timer never starts,
-- store never updates, useMicAutoPublish never enables the mic.
--
-- The auth.uid()-based participant check is safe with anon (auth.uid() returns
-- null → the EXISTS sub-query matches no rows → only the status fallback fires).

-- ============================================================
-- listening.debates
-- ============================================================
DROP POLICY IF EXISTS "debate_participants_can_read_scheduled" ON listening.debates;
CREATE POLICY "debate_participants_can_read_scheduled"
  ON listening.debates FOR SELECT
  TO authenticated, anon
  USING (
    status IN ('live', 'completed')
    OR EXISTS (
      SELECT 1 FROM listening.debate_speakers
      WHERE debate_id = debates.id
        AND user_id = (SELECT auth.uid())
    )
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
          OR EXISTS (
            SELECT 1 FROM listening.debate_speakers ds
            WHERE ds.debate_id = d.id
              AND ds.user_id = (SELECT auth.uid())
          )
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
        AND (
          d.status IN ('live', 'completed')
          OR EXISTS (
            SELECT 1 FROM listening.debate_speakers ds2
            WHERE ds2.debate_id = d.id
              AND ds2.user_id = (SELECT auth.uid())
          )
        )
    )
  );
