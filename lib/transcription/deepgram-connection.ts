import type { RemoteTrack, AudioStream as AudioStreamType } from '@livekit/rtc-node';
import { env } from '@/lib/env';
import { pool } from '@/lib/db/pool';
import { sendBroadcast } from '@/lib/supabase/broadcast';
import { computeDebateTimeMmss } from './debate-time';
import { UtteranceBuffer, type Utterance } from './utterance-buffer';

export class DeepgramLiveConnection {
  // Both assigned in start() via dynamic imports
  private socket: any = null;
  private audioStream!: AudioStreamType;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Regroups Deepgram's committed chunks into rows — see utterance-buffer.ts. */
  private readonly buffer = new UtteranceBuffer();

  constructor(
    private readonly debateId: string,
    private readonly speakerId: string,
    private readonly track: RemoteTrack,
    private readonly debateActualStart: Date,
  ) {}

  async start(): Promise<void> {
    // Lazy-load native binaries only when transcription actually begins
    const { AudioStream } = await import('@livekit/rtc-node');
    this.audioStream = new AudioStream(this.track, 16000);

    await this.connectDeepgram();
    this.streamAudio().catch(err => {
      console.error('[deepgram] streamAudio error:', err);
    });
  }

  private async connectDeepgram(): Promise<void> {
    const { DefaultDeepgramClient } = await import('@deepgram/sdk');
    // Node.js 22 exposes a global WebSocket that is incompatible with the Deepgram SDK's
    // reconnecting wrapper. Force the SDK to use the `ws` package instead.
    (globalThis as any).WebSocket = undefined;
    const client = new DefaultDeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });

    const socket = await client.listen.v1.connect({
      model: 'nova-3',
      language: 'en-US',
      interim_results: 'true',
      smart_format: 'false',
      punctuate: 'false',
      // Deepgram's default endpointing is 10ms, which calls a pause between
      // ordinary words and fires `speech_final` mid-sentence. Half a second is
      // a pause a listener would hear as one, so utterance boundaries land
      // where a reader expects a row to end.
      endpointing: 500,
      extra: { filler_words: 'true' },
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
    });

    // Wait for WebSocket to be fully open before resolving — prevents "Socket is not open" race
    await new Promise<void>((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', (err: Error) => reject(err));
    });

    socket.on('message', async (data: any) => {
      if (data.type !== 'Results') return;
      const alt = data.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      if (!data.is_final) {
        await this.broadcastInterim(alt.transcript);
        return;
      }

      // `is_final` commits a window, it does not end a sentence. The buffer
      // holds committed chunks until `speech_final` marks a real pause, and
      // returns a row's worth of words at that point.
      const utterance = this.buffer.add({
        text: alt.transcript ?? '',
        confidence: alt.confidence ?? 0,
        speechFinal: data.speech_final === true,
        receivedAt: new Date(),
      });
      if (utterance) await this.writeUtterance(utterance);
    });

    socket.on('close', () => {
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.on('error', (err: Error & { status?: number }) => {
      console.error(`[deepgram] connection error (status=${err.status ?? 'unknown'}):`, err.message);
      if (!this.stopped) this.scheduleReconnect();
    });

    this.socket = socket;
  }

  private async streamAudio(): Promise<void> {
    for await (const frame of this.audioStream) {
      if (this.stopped || !this.socket) break;
      const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      this.socket.sendMedia(pcmBuffer);
    }
  }

  /** Write one grouped utterance as a `transcript_entries` row. */
  private async writeUtterance({ text, confidence, startedAt }: Utterance): Promise<void> {
    // When the speaker *started* the sentence, not when the buffer released
    // it — this is what a quoted note anchors to. See utterance-buffer.ts.
    const spokenAt = startedAt;
    const debateTimeMmss = computeDebateTimeMmss(this.debateActualStart, spokenAt);

    try {
      await pool.query(
        `INSERT INTO listening.transcript_entries
           (debate_id, segment_id, speaker_id, spoken_at, debate_time_mmss, text, confidence_score)
         VALUES ($1,
           (SELECT id FROM listening.debate_segments
            WHERE debate_id = $1 AND status IN ('active', 'paused') LIMIT 1),
           $2, $3, $4, $5, $6)`,
        [this.debateId, this.speakerId, spokenAt, debateTimeMmss, text, confidence],
      );
    } catch (err) {
      console.error('[deepgram] DB insert failed:', err);
    }

    await this.broadcastFinal(text, spokenAt);
  }

  private async broadcastFinal(text: string, spokenAt: Date): Promise<void> {
    const debateTimeMmss = computeDebateTimeMmss(this.debateActualStart, spokenAt);
    try {
      await sendBroadcast([
        {
          topic: `transcript-${this.debateId}`,
          event: 'final',
          payload: { speakerId: this.speakerId, text, spokenAt: spokenAt.toISOString(), debateTimeMmss },
        },
      ]);
    } catch (err) {
      // The row is already in the database; only the live push is lost, and the
      // next page load will show it. Not worth retrying — more speech has
      // arrived by the time a retry would land.
      console.error('[deepgram] broadcastFinal failed:', err);
    }
  }

  private async broadcastInterim(text: string): Promise<void> {
    try {
      await sendBroadcast([
        {
          topic: `transcript-${this.debateId}`,
          event: 'interim',
          payload: { speakerId: this.speakerId, text },
        },
      ]);
    } catch (err) {
      console.error('[deepgram] broadcastInterim failed:', err);
    }
  }

  /**
   * Write whatever the buffer is holding.
   *
   * Called before the socket goes away — on reconnect and on stop — so a
   * sentence that was still accumulating is recorded instead of discarded.
   * A reconnect also means the next chunks belong to a new utterance, not a
   * continuation of this one.
   */
  private async flushBuffer(): Promise<void> {
    const utterance = this.buffer.flush();
    if (utterance) await this.writeUtterance(utterance);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.flushBuffer().catch(err => {
      console.error('[deepgram] flush before reconnect failed:', err);
    });
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;
    console.log(`[deepgram] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        await this.connectDeepgram();
      } catch (err) {
        console.error('[deepgram] reconnect failed:', err);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Async because the last words a speaker said are still in the buffer when
   * the track goes away, and the end of a closing statement is exactly the
   * part worth keeping. Callers that cannot await — LiveKit's synchronous
   * event handlers — should `void` this rather than drop the flush.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
    try {
      await this.flushBuffer();
    } catch (err) {
      console.error('[deepgram] flush on stop failed:', err);
    }
  }
}
