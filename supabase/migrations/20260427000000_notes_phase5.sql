-- Phase 5: notes — align schema with always-private design
-- Phase: 05-notes / Plan: 05-01
-- Applied to: Supabase project kxsdzaojfaibhuzmclfq (E.V Backend)
--
-- Rationale:
--   The original notes table was created with an is_private column and a
--   notes_select_own_or_public policy that could leak notes if is_private=false.
--   CONTEXT.md decision: notes are always private to the note-taker; no toggle.
--   Dropping is_private removes the risk of a future bug accidentally making
--   notes readable by others.
--
-- Changes:
--   1. DROP notes_select_own_or_public policy (must precede column drop — policy depends on column)
--   2. DROP is_private column
--   3. ADD updated_at, is_edited, rebuttal_order, source_transcript_entry_id
--   4. CREATE notes_select_own (owner-only) policy
--   5. CREATE partial index for rebuttal checklist query

-- ============================================================
-- 1. Drop the old select policy FIRST (it depends on is_private)
-- ============================================================
DROP POLICY IF EXISTS "notes_select_own_or_public" ON listening.notes;

-- ============================================================
-- 2. Drop the is_private column
--    Notes are always private — the column creates a latent public-leak risk.
--    The dependent policy above is dropped first to satisfy Postgres constraint.
-- ============================================================
ALTER TABLE listening.notes DROP COLUMN IF EXISTS is_private;

-- ============================================================
-- 3. Add new columns (idempotent via IF NOT EXISTS)
-- ============================================================

-- updated_at: NULL means never edited; populated by notes API on edit
ALTER TABLE listening.notes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- is_edited: flag that drives the "edited" indicator in the notes UI
ALTER TABLE listening.notes
  ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false;

-- rebuttal_order: NULL = not in rebuttal checklist; integer = drag-sorted position
ALTER TABLE listening.notes
  ADD COLUMN IF NOT EXISTS rebuttal_order integer;

-- source_transcript_entry_id: links a note created by flagging a transcript line;
-- ON DELETE SET NULL preserves note if transcript entry is removed
ALTER TABLE listening.notes
  ADD COLUMN IF NOT EXISTS source_transcript_entry_id uuid
    REFERENCES listening.transcript_entries(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Create owner-only select policy
--    (select auth.uid()) form enables index use per established RLS pattern.
-- ============================================================
CREATE POLICY "notes_select_own"
  ON listening.notes
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- 5. Partial index for rebuttal checklist queries
--    Covers the common query: WHERE debate_id=X AND user_id=Y AND rebuttal_order IS NOT NULL
--    Partial index skips NULL rows (most notes), keeping index small.
-- ============================================================
CREATE INDEX IF NOT EXISTS notes_rebuttal_order_idx
  ON listening.notes (debate_id, user_id, rebuttal_order)
  WHERE rebuttal_order IS NOT NULL;
