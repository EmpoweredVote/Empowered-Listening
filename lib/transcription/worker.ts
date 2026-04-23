import {
  Room,
  RoomEvent,
  TrackKind,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import { mintToken } from '@/lib/livekit/tokens';
import { pool } from '@/lib/db/pool';
import { DeepgramLiveConnection } from './deepgram-connection';

export class TranscriptionWorker {
  private room: Room;
  /** Map from participant.identity → DeepgramLiveConnection */
  private connections = new Map<string, DeepgramLiveConnection>();
  private stopped = false;

  constructor(
    private readonly debateId: string,
    private readonly roomName: string,
  ) {
    this.room = new Room();
  }

  async start(): Promise<void> {
    // 1. Fetch debate actual_start from DB
    const { rows: debateRows } = await pool.query<{ actual_start: string | null }>(
      `SELECT actual_start FROM listening.debates WHERE id = $1`,
      [this.debateId],
    );
    const debateActualStart = debateRows[0]?.actual_start
      ? new Date(debateRows[0].actual_start)
      : new Date();

    // 2. Map LiveKit participant identity → debate_speakers.id (UUID)
    const { rows: speakerRows } = await pool.query<{ livekit_identity: string; id: string }>(
      `SELECT livekit_identity, id FROM listening.debate_speakers
       WHERE debate_id = $1 AND role IN ('affirmative', 'negative')`,
      [this.debateId],
    );
    const speakerMap = new Map(speakerRows.map(r => [r.livekit_identity, r.id]));

    // 3. Mint a worker token — subscribe-only, no publish rights
    const token = await mintToken({
      identity: `transcription-worker:${this.debateId}`,
      roomName: this.roomName,
      role: 'worker',
    });

    const livekitUrl = process.env.LIVEKIT_URL;
    if (!livekitUrl) throw new Error('LIVEKIT_URL is not configured');

    // 4. Set up room event handlers before connecting
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind !== TrackKind.KIND_AUDIO) return;
        const speakerId = speakerMap.get(participant.identity);
        if (!speakerId) return; // not a debate speaker (e.g., moderator)
        if (this.connections.has(participant.identity)) return; // already connected

        const conn = new DeepgramLiveConnection(
          this.debateId,
          speakerId,
          track,
          debateActualStart,
        );
        this.connections.set(participant.identity, conn);
        conn.start().catch(err => {
          console.error(`[worker] DeepgramLiveConnection.start failed for ${participant.identity}:`, err);
          this.connections.delete(participant.identity);
        });
      },
    );

    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const conn = this.connections.get(participant.identity);
        if (conn) {
          conn.stop();
          this.connections.delete(participant.identity);
        }
      },
    );

    this.room.on(RoomEvent.Disconnected, () => {
      // Stop all active connections
      for (const conn of this.connections.values()) conn.stop();
      this.connections.clear();

      // Reconnect after 2s unless explicitly stopped
      if (!this.stopped) {
        setTimeout(() => {
          if (!this.stopped) {
            this.reconnect(token, livekitUrl);
          }
        }, 2000);
      }
    });

    // 5. Connect to room with auto-subscribe so we receive all participant tracks
    await this.room.connect(livekitUrl, token, { autoSubscribe: true, dynacast: false });
  }

  private reconnect(token: string, livekitUrl: string): void {
    this.room.connect(livekitUrl, token, { autoSubscribe: true, dynacast: false }).catch(err => {
      console.error('[worker] reconnect failed:', err);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const conn of this.connections.values()) conn.stop();
    this.connections.clear();
    await this.room.disconnect();
  }
}
