-- Grant schema USAGE + table SELECT to anon and authenticated so that
-- Supabase Realtime can evaluate RLS when delivering postgres_changes events.
--
-- Without GRANT USAGE ON SCHEMA, PostgreSQL refuses all object access before
-- RLS is even evaluated — so every Realtime event was silently dropped even
-- after the publication and RLS policies were configured correctly.

GRANT USAGE ON SCHEMA listening TO anon, authenticated;

GRANT SELECT ON listening.debates          TO anon, authenticated;
GRANT SELECT ON listening.debate_segments  TO anon, authenticated;
GRANT SELECT ON listening.debate_speakers  TO anon, authenticated;
