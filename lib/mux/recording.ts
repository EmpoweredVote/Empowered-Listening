/**
 * Pure selection logic for a live stream's recorded asset. Kept free of the
 * Mux SDK and `server-only` so it can be unit-tested.
 */

export interface RecordingAssetSummary {
  status?: string;
  duration?: number;
  playback_ids?: Array<{ id?: string; policy?: string }>;
}

export interface RecordingLookup {
  /** Public playback ID of the best ready recording, or null if none is ready. */
  playbackId: string | null;
  /** True when no recording is ready yet but at least one is still being prepared. */
  pending: boolean;
}

/**
 * Choose the recording to play. A live stream gets one asset per connection,
 * so a dropped-and-reconnected broadcast can leave several. Prefer the longest
 * ready asset that has a public playback ID.
 */
export function pickRecording(assets: RecordingAssetSummary[]): RecordingLookup {
  let best: { id: string; duration: number } | null = null;
  for (const asset of assets) {
    if (asset.status !== 'ready') continue;
    const publicId = asset.playback_ids?.find(p => p.policy === 'public' && p.id)?.id;
    if (!publicId) continue;
    const duration = asset.duration ?? 0;
    if (!best || duration > best.duration) best = { id: publicId, duration };
  }
  if (best) return { playbackId: best.id, pending: false };
  return { playbackId: null, pending: assets.some(a => a.status === 'preparing') };
}
