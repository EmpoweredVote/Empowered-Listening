-- Migration: Create listening schema with all v1 tables
-- Phase: 01-foundation / Plan: 01-01
-- Applied to: Supabase project kxsdzaojfaibhuzmclfq (E.V Backend)
--
-- FK reference choice:
--   All user_id, voter_id, created_by, proposed_by, edited_by columns reference auth.users(id).
--   The onboarding doc (2026-04-19) recommends public.users(id) in some examples, but the
--   architecture doc (empowered-listening-architecture.md v3) is the authoritative table
--   definition source and uses auth.users(id) throughout.  For v1 we follow the architecture doc.
--   Revisit when schema consolidation with the main EV instance is planned.
--
-- Table scope (9 v1 tables):
--   debates, debate_speakers, debate_segments, transcript_entries, notes,
--   cx_wrap_up_events, votes, topic_proposals, speaker_performance
--
-- Out of scope for v1 (future phases):
--   fallacy_flags, summary_checks — defined in architecture doc but not part of Phase 1-6 foundation.
--   These will be added in their respective feature phases.

CREATE SCHEMA IF NOT EXISTS listening;

-- ============================================================
-- 1. listening.debates
-- ============================================================
CREATE TABLE listening.debates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  topic text NOT NULL,
  format text NOT NULL CHECK (format IN ('lincoln_douglas', 'symposium', 'modified')),
  pillar text NOT NULL CHECK (pillar IN ('inform', 'connect', 'empower')),
  feature_context text,
  context_id uuid,
  scheduled_start timestamptz NOT NULL,
  actual_start timestamptz,
  end_time timestamptz,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
  livekit_room_name text UNIQUE,
  cloudflare_stream_id text,
  recording_url text,
  transcript_url text,
  required_badges uuid[] DEFAULT '{}',
  geographic_restriction uuid,
  peak_live_viewers integer DEFAULT 0,
  total_unique_viewers integer DEFAULT 0,
  total_replay_views integer DEFAULT 0,
  created_at timestamptz DEFAULT NOW(),
  created_by uuid REFERENCES auth.users(id)
);

-- ============================================================
-- 2. listening.debate_speakers
-- ============================================================
CREATE TABLE listening.debate_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('affirmative', 'negative', 'moderator', 'panelist')),
  display_name text NOT NULL,
  credentials text,
  bonus_time_seconds integer DEFAULT 60,  -- Per design doc: default pool is 60s
  confirmed_at timestamptz,
  livekit_identity text UNIQUE  -- encode as '<debate_id>:<user_id>' to scope identity per debate
);

-- ============================================================
-- 3. listening.debate_segments
-- ============================================================
CREATE TABLE listening.debate_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  segment_type text NOT NULL CHECK (segment_type IN (
    'opening_statement',
    'affirmative_constructive', 'negative_constructive',
    'cross_examination_by_neg', 'cross_examination_by_aff',
    'affirmative_rebuttal_1', 'negative_rebuttal', 'affirmative_rebuttal_2',
    'summary_check', 'closing', 'last_word', 'last_speaker_vote', 'audience_vote'
  )),
  speaker_id uuid REFERENCES listening.debate_speakers(id),
  sequence_order integer NOT NULL,
  allocated_seconds integer NOT NULL,
  bonus_seconds_used integer DEFAULT 0,
  actual_start timestamptz,
  actual_end timestamptz,
  status text NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'completed', 'paused')),
  UNIQUE(debate_id, sequence_order)
);

-- ============================================================
-- 4. listening.transcript_entries
-- ============================================================
CREATE TABLE listening.transcript_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES listening.debate_segments(id),
  speaker_id uuid REFERENCES listening.debate_speakers(id),
  spoken_at timestamptz NOT NULL,
  debate_time_mmss text NOT NULL,
  text text NOT NULL,
  confidence_score numeric(3,2),
  character_start integer,
  character_end integer,
  edited boolean DEFAULT false,
  edited_at timestamptz,
  edited_by uuid REFERENCES auth.users(id)
);

CREATE INDEX ON listening.transcript_entries(debate_id, spoken_at);
CREATE INDEX ON listening.transcript_entries USING gin (to_tsvector('english', text));

-- ============================================================
-- 5. listening.notes
-- ============================================================
CREATE TABLE listening.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES listening.debate_segments(id),
  content text NOT NULL,
  debate_time_mmss text,
  is_private boolean DEFAULT false,  -- Private notes require explicit toggle
  created_at timestamptz DEFAULT NOW()
);

-- ============================================================
-- 6. listening.cx_wrap_up_events
-- Audit trail for cross-examination "wrap it up" interactions
-- ============================================================
CREATE TABLE listening.cx_wrap_up_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES listening.debate_segments(id),
  questioner_id uuid REFERENCES listening.debate_speakers(id),
  examined_id uuid REFERENCES listening.debate_speakers(id),
  button_pressed_at timestamptz NOT NULL,
  debate_time_mmss text NOT NULL,
  countdown_expired_at timestamptz,
  overage_seconds integer DEFAULT 0,        -- seconds examined spoke past 5s window
  bonus_transferred integer DEFAULT 0,      -- seconds moved from examined to questioner pool
  created_at timestamptz DEFAULT NOW()
);

-- ============================================================
-- 7. listening.votes
-- Unified vote table covering all vote types
-- ============================================================
CREATE TABLE listening.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  voter_id uuid REFERENCES auth.users(id),
  vote_type text NOT NULL CHECK (vote_type IN (
    'winner',
    'last_speaker',
    'topic_selection',
    'summary_check_trigger',
    'summary_check_accuracy',
    'summary_check_similarity'
  )),
  target_id uuid,
  vote_value text,
  segment_id uuid REFERENCES listening.debate_segments(id),
  badges_held uuid[],
  created_at timestamptz DEFAULT NOW(),
  -- Note: target_id is nullable; Postgres NULL != NULL in unique constraints, so
  -- this constraint alone does not prevent duplicate votes where target_id IS NULL.
  -- Enforce uniqueness for null-target vote types via a partial unique index:
  -- CREATE UNIQUE INDEX votes_null_target_unique ON listening.votes (debate_id, voter_id, vote_type) WHERE target_id IS NULL;
  UNIQUE(debate_id, voter_id, vote_type, target_id)
);

-- Partial unique index to prevent duplicate votes where target_id is NULL
-- (the standard UNIQUE constraint cannot handle nullable columns for this case)
CREATE UNIQUE INDEX votes_null_target_unique
  ON listening.votes (debate_id, voter_id, vote_type)
  WHERE target_id IS NULL;

-- ============================================================
-- 8. listening.topic_proposals
-- For Vote Type 2 (Next Topic Selection)
-- ============================================================
CREATE TABLE listening.topic_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  proposed_by uuid REFERENCES auth.users(id),
  vote_window_start timestamptz,
  vote_window_end timestamptz,
  vote_count integer DEFAULT 0,
  selected boolean DEFAULT false
);

-- ============================================================
-- 9. listening.speaker_performance
-- ============================================================
CREATE TABLE listening.speaker_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  debate_id uuid REFERENCES listening.debates(id),
  summary_checks_faced integer DEFAULT 0,
  avg_summary_check_accuracy numeric(5,2),
  avg_summary_check_similarity numeric(5,2),
  fallacy_flags_received integer DEFAULT 0,
  fallacy_flags_validated integer DEFAULT 0,
  audience_winner_vote_share numeric(5,2),
  won_last_word boolean,
  recorded_at timestamptz DEFAULT NOW()
);
