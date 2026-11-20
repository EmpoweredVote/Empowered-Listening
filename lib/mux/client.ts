import 'server-only';
import Mux from '@mux/mux-node';
import { env } from '@/lib/env';
import { pickRecording, type RecordingLookup } from './recording';

let _mux: Mux | null = null;

function getMux(): Mux {
  if (!_mux) {
    _mux = new Mux({
      tokenId: env.MUX_TOKEN_ID,
      tokenSecret: env.MUX_TOKEN_SECRET,
    });
  }
  return _mux;
}

export interface MuxStreamInfo {
  muxStreamId: string;
  muxStreamKey: string;
  muxPlaybackId: string;
}

export async function createMuxLiveStream(): Promise<MuxStreamInfo> {
  const stream = await getMux().video.liveStreams.create({
    playback_policies: ['public'],
    new_asset_settings: { playback_policies: ['public'] },
    latency_mode: 'reduced',
    reconnect_window: 0,
  });
  const playback = stream.playback_ids?.[0];
  if (!stream.id || !stream.stream_key || !playback?.id) {
    throw new Error('Mux live stream response missing id, stream_key, or playback_ids[0]');
  }
  return {
    muxStreamId:   stream.id,
    muxStreamKey:  stream.stream_key,
    muxPlaybackId: playback.id,
  };
}

/**
 * End a live *session* on a stream that really did ingest.
 *
 * This is the right call at the end of a debate, and only there: it finalises
 * the recording and leaves the stream object in place as `idle`, so
 * `findLiveStreamRecording` can still read its `recent_asset_ids` afterwards.
 * Deleting here would take the recording with it.
 *
 * It is the WRONG call for a stream that never received a frame — see
 * `deleteMuxLiveStream`.
 */
export async function completeMuxLiveStream(muxStreamId: string): Promise<void> {
  await getMux().video.liveStreams.complete(muxStreamId);
}

/**
 * Remove a stream object that never ingested.
 *
 * `complete()` ends a session; it does not release the stream. A stream that
 * never received a frame has no session to end, so completing it leaves the
 * object behind as `idle` forever. That is issue #99: the egress bootstrap
 * creates a Mux stream, LiveKit then refuses the egress (the transcode
 * allowance is spent until ~1 Dec 2026), and the rollback called `complete()`
 * while believing it had released the stream. `mux_stream_id` is cleared in
 * the same rollback, so nothing in the app could ever find those streams
 * again — two were left behind by a single debate on 2026-11-18 and had to be
 * deleted by hand.
 *
 * There is no recording to protect in that case: the stream never ingested, so
 * `recent_asset_ids` is empty and deleting costs nothing.
 */
export async function deleteMuxLiveStream(muxStreamId: string): Promise<void> {
  await getMux().video.liveStreams.delete(muxStreamId);
}

/**
 * Look up the recorded asset Mux made from a live stream (via the stream's
 * recent_asset_ids). Returns the best ready recording's public playback ID.
 */
export async function findLiveStreamRecording(muxStreamId: string): Promise<RecordingLookup> {
  const mux = getMux();
  const stream = await mux.video.liveStreams.retrieve(muxStreamId);
  const assetIds = stream.recent_asset_ids ?? [];
  const assets = await Promise.all(assetIds.map(id => mux.video.assets.retrieve(id)));
  return pickRecording(assets);
}
