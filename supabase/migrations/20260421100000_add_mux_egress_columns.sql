-- Migration: Phase 3 — add Mux live stream + LiveKit egress columns to listening.debates
-- Phase: 03-observer-streaming / Plan: 03-01

ALTER TABLE listening.debates
  ADD COLUMN IF NOT EXISTS mux_stream_id     text,
  ADD COLUMN IF NOT EXISTS mux_stream_key    text,
  ADD COLUMN IF NOT EXISTS mux_playback_id   text,
  ADD COLUMN IF NOT EXISTS livekit_egress_id text;

COMMENT ON COLUMN listening.debates.mux_stream_key IS
  'Secret RTMP ingest credential — nulled out after egress starts. Do NOT expose via API.';
COMMENT ON COLUMN listening.debates.mux_playback_id IS
  'Public Mux playback ID — used by /api/debates/[id]/stream and HLS URL https://stream.mux.com/<id>.m3u8';
COMMENT ON COLUMN listening.debates.livekit_egress_id IS
  'Active LiveKit egress job ID; nulled out on stop.';
