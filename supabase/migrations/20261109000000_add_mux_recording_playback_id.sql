-- Replay for completed debates.
--
-- mux_playback_id holds the LIVE stream's playback ID. Once Mux marks the live
-- stream complete, that ID returns HTTP 412 (live_stream_inactive), so it cannot
-- play the debate back. Mux saves the broadcast as a separate asset with its own
-- playback ID; this column stores it. The app fills it lazily the first time a
-- completed debate is viewed (lib/debates/recording.ts), which also backfills
-- debates completed before this migration.

ALTER TABLE listening.debates
  ADD COLUMN IF NOT EXISTS mux_recording_playback_id text;

COMMENT ON COLUMN listening.debates.mux_recording_playback_id IS
  'Public Mux playback ID of the recorded asset for a completed debate. HLS URL https://stream.mux.com/<id>.m3u8. Filled on first view after the asset is ready.';
