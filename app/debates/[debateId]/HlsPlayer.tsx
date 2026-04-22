'use client';

/**
 * HlsPlayer — client-only HLS video player with Safari native fallback.
 *
 * Parent contract: the parent MUST NOT render <HlsPlayer> until `src` is
 * available (i.e. debate status === 'live' AND mux_playback_id is non-null).
 * hls.js does not retry on 404; mounting against a missing stream URL will
 * result in an immediate NETWORK_ERROR rather than a graceful retry.
 */

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface HlsPlayerProps {
  /** Full m3u8 URL — the parent is responsible for building it. */
  src: string;
  /** Optional extra classes for the outer wrapper div. */
  className?: string;
  /** Badge label shown during active playback. Defaults to 'LIVE · delayed ~5-10s'. */
  badgeLabel?: string;
}

type PlayerState = 'loading' | 'playing' | 'error';

export default function HlsPlayer({
  src,
  className,
  badgeLabel,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      // Chrome / Firefox / Edge — use hls.js via MSE
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        lowLatencyMode: false,   // Mux 'reduced' latency is standard HLS, not LL-HLS
        maxBufferLength: 30,
        enableWorker: true,
      });

      // attachMedia BEFORE loadSource — required order per hls.js docs
      hls.attachMedia(video);
      hls.loadSource(src);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerState('playing');
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Attempt recovery — hls.js can reconnect after transient network issues
            hls.startLoad();
          } else {
            // Media or other fatal errors are not recoverable
            setPlayerState('error');
          }
        }
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS support via the <video> element
      video.src = src;
      video.addEventListener(
        'loadedmetadata',
        () => setPlayerState('playing'),
        { once: true },
      );
    } else {
      // Browser supports neither hls.js nor native HLS
      setPlayerState('error');
    }
  }, [src]);

  return (
    <div className={`relative w-full aspect-video bg-black ${className ?? ''}`}>
      <video ref={videoRef} controls playsInline className="w-full h-full" />

      {playerState === 'playing' && (
        <div
          className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded"
          role="status"
          aria-live="polite"
        >
          {badgeLabel ?? 'LIVE · delayed ~5-10s'}
        </div>
      )}

      {playerState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          Connecting to stream…
        </div>
      )}

      {playerState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400">
          Stream unavailable. Please try again shortly.
        </div>
      )}
    </div>
  );
}
