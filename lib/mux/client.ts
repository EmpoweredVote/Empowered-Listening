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

export async function completeMuxLiveStream(muxStreamId: string): Promise<void> {
  await getMux().video.liveStreams.complete(muxStreamId);
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
