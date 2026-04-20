-- Migration: Enable RLS and create policies for all listening schema tables
-- Phase: 01-foundation / Plan: 01-01
-- Applied to: Supabase project kxsdzaojfaibhuzmclfq (E.V Backend)
--
-- Performance rules applied throughout:
--   1. Always specify TO authenticated or TO anon (prevents policy check on wrong roles)
--   2. Always wrap auth.uid() as (select auth.uid()) to allow index use
--   3. Never grant TO public — all policies target explicit roles
--
-- Role mapping for v1:
--   observer     = anon or authenticated (read-only access to live/completed debates)
--   connected    = authenticated (can vote, take notes, flag fallacies — gated in app code)
--   empowered    = authenticated (can be a debate speaker — gated in app code)
--   moderator    = authenticated (can update debate/segment state — gated in app code via role check)
--
-- Note: Moderator UPDATE policies are deferred to application-layer role checks in Phase 2
-- when the listening_moderator role slug is registered with the accounts platform.
-- Phase 2 will add SECURITY DEFINER RPCs for moderator state transitions.

-- ============================================================
-- Enable RLS on all 9 v1 tables
-- ============================================================
ALTER TABLE listening.debates ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.debate_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.debate_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.transcript_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.cx_wrap_up_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.topic_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening.speaker_performance ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- listening.debates policies
-- ============================================================

-- Observers (authenticated or anonymous) can read live and completed debates
CREATE POLICY "debates_select_public"
  ON listening.debates
  FOR SELECT
  TO authenticated, anon
  USING (status IN ('live', 'completed'));

-- All writes go through service role (pool.query with transaction pooler).
-- No public INSERT/UPDATE/DELETE policies for debates.
-- Moderator UPDATE is handled via SECURITY DEFINER RPC in Phase 2.

-- ============================================================
-- listening.debate_speakers policies
-- ============================================================

-- Anyone can read speaker roster for live or completed debates
CREATE POLICY "debate_speakers_select_public"
  ON listening.debate_speakers
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_id
      AND d.status IN ('live', 'completed')
    )
  );

-- All writes go through service role (no public write policies).

-- ============================================================
-- listening.debate_segments policies
-- ============================================================

-- Observers can read segment data for live or completed debates
CREATE POLICY "debate_segments_select_public"
  ON listening.debate_segments
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_id
      AND d.status IN ('live', 'completed')
    )
  );

-- All writes (status transitions) go through SECURITY DEFINER RPCs or service role.

-- ============================================================
-- listening.transcript_entries policies
-- ============================================================

-- Observers can read transcript for live or completed debates
CREATE POLICY "transcript_entries_select_public"
  ON listening.transcript_entries
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_id
      AND d.status IN ('live', 'completed')
    )
  );

-- All writes go through service role (Deepgram transcription pipeline).
-- Moderator corrections handled via SECURITY DEFINER RPC in Phase 3.

-- ============================================================
-- listening.notes policies
-- ============================================================

-- Authenticated users can read their own notes plus any non-private notes
CREATE POLICY "notes_select_own_or_public"
  ON listening.notes
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id OR is_private = false);

-- Authenticated users can insert their own notes
CREATE POLICY "notes_insert_own"
  ON listening.notes
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Authenticated users can update their own notes
CREATE POLICY "notes_update_own"
  ON listening.notes
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Authenticated users can delete their own notes
CREATE POLICY "notes_delete_own"
  ON listening.notes
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- listening.cx_wrap_up_events policies
-- ============================================================

-- Observers can read CX wrap-up events for live or completed debates
CREATE POLICY "cx_wrap_up_events_select_public"
  ON listening.cx_wrap_up_events
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_id
      AND d.status IN ('live', 'completed')
    )
  );

-- All writes go through service role (CX mechanic is server-authoritative).

-- ============================================================
-- listening.votes policies
-- ============================================================

-- Authenticated users can read their own votes
-- (Aggregate tallies are computed by service role, bypassing RLS)
CREATE POLICY "votes_select_own"
  ON listening.votes
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = voter_id);

-- Authenticated users can insert votes for themselves
-- (Connected/Empowered tier check is enforced in application code before INSERT)
CREATE POLICY "votes_insert_own"
  ON listening.votes
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = voter_id);

-- No UPDATE or DELETE on votes — votes are immutable once cast.
-- The UNIQUE constraint on the table and the partial unique index prevent duplicate votes.

-- ============================================================
-- listening.topic_proposals policies
-- ============================================================

-- Anyone can read topic proposals
CREATE POLICY "topic_proposals_select_public"
  ON listening.topic_proposals
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- INSERT/UPDATE are deferred to application code (moderator check).
-- Service role handles writes for now.

-- ============================================================
-- listening.speaker_performance policies
-- ============================================================

-- Anyone can read speaker performance records for completed debates
CREATE POLICY "speaker_performance_select_public"
  ON listening.speaker_performance
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM listening.debates d
      WHERE d.id = debate_id
      AND d.status = 'completed'
    )
  );

-- All writes go through service role (post-debate computation pipeline).
