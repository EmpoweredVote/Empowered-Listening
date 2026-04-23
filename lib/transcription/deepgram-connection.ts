import { DefaultDeepgramClient, type Deepgram } from '@deepgram/sdk';
import { AudioStream, type RemoteTrack } from '@livekit/rtc-node';
import { env } from '@/lib/env';
import { pool } from '@/lib/db/pool';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeDebateTimeMmss } from './debate-time';

const UNAVAILABLE_THRESHOLD = 0.10;
const INAUDIBLE_THRESHOLD = 0.20;

// V1Socket type from the Deepgram SDK
type V1Socket = Awaited<ReturnType<InstanceType<typeof DefaultDeepgramClient>['listen']['v1']['connect']>>;

export class DeepgramLiveConnection {
  private socket: V1Socket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private audioStream: AudioStream;

  constructor(
    private readonly debateId: string,
    private readonly speakerId: string,       // listening.debate_speakers.id (UUID)
    private readonly track: RemoteTrack,
    private readonly debateActualStart: Date,
  ) {
    // Resample from WebRTC's 48kHz to 16kHz (Deepgram standard)
    this.audioStream = new AudioStream(track, 16000);
  }

  async start(): Promise<void> {
    await this.connectDeepgram();
    // Fire-and-forget audio streaming loop
    this.streamAudio().catch(err => {
      console.error('[deepgram] streamAudio error:', err);
    });
  }

  private async connectDeepgram(): Promise<void> {
    const client = new DefaultDeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });

    const socket = await client.listen.v1.connect({
      model: 'nova-3',
      language: 'en-US',
      interim_results: 'true',
      smart_format: 'false',
      punctuate: 'false',
      // filler_words passed as extra query param (not in v5 SDK ConnectArgs)
      extra: { filler_words: 'true' },
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
    });

    socket.on('message', async (data: Deepgram.listen.ListenV1Results | Deepgram.listen.ListenV1Metadata | Deepgram.listen.ListenV1UtteranceEnd | Deepgram.listen.ListenV1SpeechStarted) => {
      if (data.type !== 'Results') return;
      const result = data as Deepgram.listen.ListenV1Results;
      const alt = result.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      if (!result.is_final) {
        await this.broadcastInterim(alt.transcript);
        return;
      }

      // Filter low-confidence chunks
      if ((alt.confidence ?? 0) < UNAVAILABLE_THRESHOLD) return;

      // Filter individual inaudible words
      const text = (alt.words ?? [])
        .filter(w => (w.confidence ?? 0) >= INAUDIBLE_THRESHOLD)
        .map(w => w.word ?? '')
        .join(' ')
        .trim();

      if (!text) return;
      await this.onFinalTranscript(text, alt.confidence ?? 0);
    });

    socket.on('close', () => {
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.on('error', (err: Error) => {
      console.error('[deepgram] connection error:', err);
      if (!this.stopped) this.scheduleReconnect();
    });

    this.socket = socket;
  }

  private async streamAudio(): Promise<void> {
    for await (const frame of this.audioStream) {
      if (this.stopped || !this.socket) break;
      // Convert Int16Array to Buffer BEFORE sending — Deepgram rejects Int16Array directly
      const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      this.socket.sendMedia(pcmBuffer);
    }
  }

  private async onFinalTranscript(text: string, confidence: number): Promise<void> {
    const spokenAt = new Date();
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
      const supabase = getSupabaseAdmin();
      const channel = supabase.channel(`transcript-${this.debateId}`);
      await channel.send({
        type: 'broadcast',
        event: 'final',
        payload: {
          speakerId: this.speakerId,
          text,
          spokenAt: spokenAt.toISOString(),
          debateTimeMmss,
        },
      });
      await supabase.removeChannel(channel);
    } catch (err) {
      console.error('[deepgram] broadcastFinal failed:', err);
    }
  }

  private async broadcastInterim(text: string): Promise<void> {
    try {
      const supabase = getSupabaseAdmin();
      const channel = supabase.channel(`transcript-${this.debateId}`);
      await channel.send({
        type: 'broadcast',
        event: 'interim',
        payload: {
          speakerId: this.speakerId,
          text,
        },
      });
      await supabase.removeChannel(channel);
    } catch (err) {
      console.error('[deepgram] broadcastInterim failed:', err);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
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

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore errors on close
      }
      this.socket = null;
    }
  }
}
