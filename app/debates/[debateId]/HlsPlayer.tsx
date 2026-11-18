'use client';

/**
 * HlsPlayer — client-only HLS video player with Safari native fallback.
 *
 * Parent contract: the parent MUST NOT render <HlsPlayer> until `src` is
 * available (a live stream or a completed debate's recording playback ID).
 * hls.js does not retry on 404; mounting against a missing stream URL will
 * result in an immediate NETWORK_ERROR rather than a graceful retry.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
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

/**
 * Attaching hls.js and parsing a manifest does not make a video play. Nothing
 * here ever called play(), and the <video> had no autoPlay, so a healthy
 * stream buffered its first frame and stopped — which looked exactly like a
 * broken stream, and was mistaken for one for a long time.
 *
 * Autoplay has to start muted: browsers block audible autoplay, and a rejected
 * play() leaves the same frozen frame. So it starts muted and offers sound.
 */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;
/** A live debate's stream can legitimately 404 for a while before egress reaches Mux. */
const MAX_RETRIES = 12;

export default function HlsPlayer({
  src,
  className,
  badgeLabel,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const [isMuted, setIsMuted] = useState(true);
  /** play() was rejected outright — the viewer has to start it themselves. */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Bumped by "Try again" to re-run the effect against the same src. */
  const [reloadKey, setReloadKey] = useState(0);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(
      () => setNeedsGesture(false),
      () => setNeedsGesture(true),
    );
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setPlayerState('loading');
    setNeedsGesture(false);

    if (Hls.isSupported()) {
      // Chrome / Firefox / Edge — use hls.js via MSE
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        lowLatencyMode: false,   // Mux 'reduced' latency is standard HLS, not LL-HLS
        maxBufferLength: 30,
        enableWorker: true,
      });

      let retries = 0;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;

      // attachMedia BEFORE loadSource — required order per hls.js docs
      hls.attachMedia(video);
      hls.loadSource(src);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retries = 0;
        setPlayerState('playing');
        startPlayback();
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Backed off and bounded. The previous version called startLoad()
          // immediately on every fatal network error, which against a stream
          // that is simply not live yet is an unbounded hot retry loop.
          if (destroyed || retries >= MAX_RETRIES) {
            setPlayerState('error');
            return;
          }
          const delay = Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_MAX_MS);
          retries++;
          retryTimer = setTimeout(() => {
            if (!destroyed) hls.startLoad();
          }, delay);
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          // Recoverable in hls.js's own terms — worth one attempt before giving up.
          hls.recoverMediaError();
          return;
        }

        setPlayerState('error');
      });

      return () => {
        destroyed = true;
        if (retryTimer) clearTimeout(retryTimer);
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS support via the <video> element
      video.src = src;
      const onLoaded = () => {
        setPlayerState('playing');
        startPlayback();
      };
      const onError = () => setPlayerState('error');
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError);
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
    } else {
      // Browser supports neither hls.js nor native HLS
      setPlayerState('error');
    }
  }, [src, startPlayback, reloadKey]);

  function unmute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setIsMuted(false);
    // The click is a user gesture, so this also clears a blocked autoplay.
    startPlayback();
  }

  return (
    <div className={`relative w-full aspect-video bg-black ${className ?? ''}`}>
      {/*
        autoPlay + muted is the only combination browsers will start on their
        own. playsInline keeps iOS from taking over the whole screen.
      */}
      <video
        ref={videoRef}
        controls
        autoPlay
        muted
        playsInline
        className="w-full h-full"
        onVolumeChange={e => setIsMuted(e.currentTarget.muted)}
      />

      {playerState === 'playing' && (
        <div
          className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded"
          role="status"
          aria-live="polite"
        >
          {badgeLabel ?? 'LIVE · delayed ~5-10s'}
        </div>
      )}

      {/* Muted autoplay is the price of autoplay at all. A debate is useless
          without sound, so the way back to it has to be obvious. */}
      {playerState === 'playing' && isMuted && !needsGesture && (
        <button
          type="button"
          onClick={unmute}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg hover:bg-white"
        >
          🔇 Tap for sound
        </button>
      )}

      {/* play() was refused even muted — only a real click will start it. */}
      {needsGesture && (
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (video) video.muted = false;
            setIsMuted(false);
            startPlayback();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 text-white"
        >
          <span className="rounded-full bg-white/90 px-5 py-3 text-base font-semibold text-slate-900 shadow-lg">
            ▶ Play
          </span>
        </button>
      )}

      {playerState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          Connecting to stream…
        </div>
      )}

      {playerState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-red-400">
          <p>Stream unavailable.</p>
          <button
            type="button"
            // Re-runs the effect against the same src, tearing down the dead
            // hls instance and building a fresh one with the retry count reset.
            onClick={() => setReloadKey(k => k + 1)}
            className="rounded border border-red-400 px-3 py-1.5 text-sm text-red-300 hover:bg-red-400/10"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
