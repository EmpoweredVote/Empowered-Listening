-- Migration: Phase 4 — transcript Realtime publication + original_text column
-- Phase: 04-transcription / Plan: 04-03

-- 1. Add original_text column for moderator edit history.
--    SECURITY DEFINER RPC in 04-04 stores the original Deepgram output here on first edit.
ALTER TABLE listening.transcript_entries
  ADD COLUMN IF NOT EXISTS original_text text;

-- 2. Add to Realtime publication so observers can subscribe via Supabase Realtime
--    postgres_changes events. Without this, INSERT/UPDATE events will never fire.
ALTER PUBLICATION supabase_realtime ADD TABLE listening.transcript_entries;

-- 3. REPLICA IDENTITY FULL ensures the complete row is delivered in Realtime events.
--    Required for Supabase Realtime to include all columns on INSERT/UPDATE payloads.
ALTER TABLE listening.transcript_entries REPLICA IDENTITY FULL;

-- 4. Ensure SELECT grants are in place for both roles.
--    These may already exist from Phase 1 RLS policies, but idempotent GRANT is safe.
GRANT SELECT ON listening.transcript_entries TO authenticated, anon;
