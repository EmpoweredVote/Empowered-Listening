-- Give quoted notes back the time of the line they quote.
--
-- `TranscriptSelectionPopup` sends `debateTimeMmss: null` alongside a real
-- `sourceTranscriptEntryId`, and POST /notes took that null verbatim instead of
-- deriving the time from the entry it was writing in the same statement.  So a
-- note that quotes a transcript line was stored correctly linked and entirely
-- untimed (issue #101).
--
-- In the exported PDF such a note aligns to index -1 and renders in the
-- pre-transcript block with no `@ mm:ss` — parked above the debate rather than
-- beside the line it quotes, which is the whole point of quoting it.
--
-- The route is fixed to derive the value on write.  This repairs the rows that
-- were written before that, which the route cannot reach.
--
-- Scope:
--
--   * only notes that have an anchor and no time — a note with a time of its
--     own is a free-typed note and is left alone;
--   * only where the anchored entry belongs to the SAME debate as the note, so
--     a row can never borrow a time across debates.  `source_transcript_entry_id`
--     has no composite constraint tying it to `debate_id`, so this is checked
--     rather than assumed;
--   * `transcript_entries.debate_time_mmss` is NOT NULL, so every matched row
--     yields a real value and none of these can end up null again.
--
-- One row qualified when this was written (a note from the Phase 5 UAT run on
-- debate 80110ad3).  The statement is a no-op on any database without such
-- rows, including a fresh local stack.

-- Applied to production on 2026-11-20 through the Supabase API, which stamps
-- the version at apply time.  The filename carries that stamp rather than a
-- round number so the repo and the remote migration history agree; renaming
-- it back would make `supabase db push` see this as pending and re-run it.

UPDATE listening.notes n
   SET debate_time_mmss = te.debate_time_mmss
  FROM listening.transcript_entries te
 WHERE te.id = n.source_transcript_entry_id
   AND te.debate_id = n.debate_id
   AND n.debate_time_mmss IS NULL;
