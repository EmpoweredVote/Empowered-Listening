# Phase 4: Transcription - Research

**Researched:** 2026-04-22
**Domain:** Deepgram streaming STT, @livekit/rtc-node server-side audio, Supabase Realtime broadcast, Postgres FTS
**Confidence:** HIGH overall (core APIs verified via official docs; codebase read directly)

---

## Summary

Phase 4 adds real-time transcription to the debate infrastructure.  The backend worker joins the LiveKit room as a server-side participant using `@livekit/rtc-node`, subscribes to each speaker's audio track, and streams the PCM audio frames to Deepgram's live streaming WebSocket API.  When Deepgram finalizes a transcript result, the worker inserts a row into `listening.transcript_entries` and publishes a Supabase Realtime broadcast event so observers receive it within 1-3 seconds.  Observers subscribe to that broadcast channel and maintain a local array of transcript entries rendered in the transcript panel.

The `listening.transcript_entries` table already exists with the correct schema (including `debate_id`, `segment_id`, `speaker_id`, `spoken_at`, `debate_time_mmss`, `text`, `confidence_score`, `edited`, `edited_at`, `edited_by`) and already has a GIN full-text index (`CREATE INDEX ON listening.transcript_entries USING gin (to_tsvector('english', text))`).  The RLS policy allows `anon` and `authenticated` to SELECT.  No schema changes are needed for 04-03.

The Deepgram model recommendation is **Nova-3** (not Nova-2), which reached General Availability in February 2025 with streaming WER of 6.84% vs Nova-2's 9.09%.  Pricing difference is small ($0.0077/min vs $0.0058/min) and the $200 free credit covers both.  Nova-3 is the better choice for a verbatim civic record requiring high accuracy.

**Primary recommendation:** Worker uses `@livekit/rtc-node` to join as a server-side participant, subscribes to per-speaker audio tracks via `AudioStream`, streams `Int16Array` PCM frames to Deepgram SDK v5 connections (one per track), inserts final results into `listening.transcript_entries` via `pool.query()`, and broadcasts via Supabase REST broadcast API.  Observer transcript panel subscribes to the broadcast channel and renders interim results in italic while final results are committed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@livekit/rtc-node` | 0.13.25 (latest, Apr 7 2026) | Server-side LiveKit participant — connect to room, subscribe to audio tracks, read AudioFrames | Only Node.js SDK that connects as a room participant and reads audio; livekit-client is browser-only |
| `@deepgram/sdk` | 5.0.0 (latest, Mar 4 2026) | Deepgram live streaming transcription WebSocket client | Official Deepgram SDK; v5 is the current major version |
| `@supabase/supabase-js` | ^2.104.0 (already installed) | Supabase REST broadcast from worker + Realtime subscription on client | Already in project — reuse exact pattern |
| `pg` (node-postgres) | ^8.20.0 (already installed) | Insert transcript_entries rows | Already established pattern: all `listening` schema writes via pool.query() |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `livekit-server-sdk` | ^2.15.1 (already installed) | Mint an access token for the transcription worker identity | Worker needs a token to join the room; use existing mintToken pattern with a worker role |
| `zod` | ^4.3.6 (already installed) | Validate moderator edit request bodies | All POST API routes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nova-3 | Nova-2 | Nova-2 costs 25% less ($0.0058/min vs $0.0077/min) but has 9.09% vs 6.84% WER. For a verbatim civic record, accuracy wins. Both models covered by $200 free credit. |
| Nova-3 | Nova-2-meeting | Nova-2-meeting is optimized for multi-speaker conference audio with a single mic — the project uses separate per-speaker tracks, making the "meeting" optimization irrelevant. Nova-3 is strictly better. |
| Supabase Realtime Broadcast (REST) | postgres_changes on INSERT | postgres_changes on transcript_entries would work but the JOIN complexity for live filtering is higher. Broadcast is more direct: worker sends a lightweight event; client receives and renders immediately. Both approaches work — broadcast chosen for simplicity and lower latency. |
| `@livekit/rtc-node` (join as participant) | LiveKit Track Egress (WebSocket) | Track Egress sends raw PCM to a WebSocket server you control, which then forwards to Deepgram. Adds an extra hop and requires running a WebSocket server. `@livekit/rtc-node` is cleaner: join the room, subscribe to tracks directly in the worker process. |

**Installation (new packages only):**
```bash
npm install @livekit/rtc-node @deepgram/sdk
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
└── api/
    └── debates/
        └── [debateId]/
            ├── transcription/
            │   └── route.ts         # POST start-worker / DELETE stop-worker
            └── transcript/
                └── route.ts         # GET transcript history (paginated)
    └── moderator/
        └── debates/
            └── [debateId]/
                └── transcript/
                    └── page.tsx     # Moderator correction UI (/moderator/debates/[id]/transcript)
lib/
└── transcription/
    ├── worker.ts                    # TranscriptionWorker class (manages room join + per-track connections)
    ├── deepgram-connection.ts       # One DeepgramLiveConnection per speaker track
    └── debate-time.ts               # computeDebateTimeMmss(debateActualStart, spokentAt)
components/
└── transcript/
    ├── TranscriptPanel.tsx          # Live transcript panel (observer-facing, replaces Phase 3 placeholder)
    ├── TranscriptEntry.tsx          # Single entry: speaker label + timestamp + text
    ├── TranscriptInterim.tsx        # Interim result display (italic, lighter)
    └── moderator/
        └── TranscriptEditor.tsx    # Inline click-to-edit moderator correction UI
supabase/
└── migrations/
    └── 04-transcription_rpcs.sql   # SECURITY DEFINER RPC: correct_transcript_entry
```

### Pattern 1: Backend Transcription Worker — Room Join + Track Subscribe

**What:** Server-side Node.js process joins the LiveKit room as a special participant using `@livekit/rtc-node`, subscribes to each speaker's audio track, and creates one Deepgram live connection per track.
**When to use:** Started when the debate goes live (triggered by the moderator starting the first segment); stopped when the debate completes.

```typescript
// Source: @livekit/rtc-node v0.13.25 docs + LiveKit node-sdks GitHub
// lib/transcription/worker.ts
import {
  Room, RoomEvent, TrackKind, AudioStream,
  type RemoteTrack, type RemoteParticipant,
} from '@livekit/rtc-node';
import { mintToken } from '@/lib/livekit/tokens';
import { DeepgramLiveConnection } from './deepgram-connection';

export class TranscriptionWorker {
  private room: Room;
  private connections = new Map<string, DeepgramLiveConnection>(); // identity → connection

  constructor(
    private readonly debateId: string,
    private readonly roomName: string,
    private readonly speakerIdentities: Record<string, string>, // identity → speakerId (DB)
    private readonly actualStart: Date,
  ) {
    this.room = new Room();
  }

  async start(): Promise<void> {
    // Mint a worker token with subscribe-only permission
    const token = await mintToken({
      identity: `transcription-worker:${this.debateId}`,
      roomName: this.roomName,
      role: 'worker',  // canSubscribe: true, canPublish: false
    });

    this.room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this));
    this.room.on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed.bind(this));
    this.room.on(RoomEvent.Disconnected, this.handleDisconnected.bind(this));

    await this.room.connect(process.env.LIVEKIT_URL!, token, {
      autoSubscribe: true,
    });
  }

  private async handleTrackSubscribed(
    track: RemoteTrack,
    _publication: unknown,
    participant: RemoteParticipant,
  ): Promise<void> {
    if (track.kind !== TrackKind.KIND_AUDIO) return;

    const speakerId = this.speakerIdentities[participant.identity];
    if (!speakerId) return; // not a speaker track we care about

    const audioStream = new AudioStream(track);
    const conn = new DeepgramLiveConnection(
      this.debateId,
      speakerId,
      participant.identity,
      audioStream,
      this.actualStart,
    );
    this.connections.set(participant.identity, conn);
    await conn.start();
  }

  private handleTrackUnsubscribed(_track: RemoteTrack, _pub: unknown, participant: RemoteParticipant): void {
    const conn = this.connections.get(participant.identity);
    if (conn) {
      conn.stop();
      this.connections.delete(participant.identity);
    }
  }

  private handleDisconnected(): void {
    // Reconnect logic — see Pattern 4
  }

  async stop(): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.stop();
    }
    this.connections.clear();
    await this.room.disconnect();
  }
}
```

### Pattern 2: Deepgram Live Connection — Per-Track Streaming

**What:** One `DeepgramLiveConnection` per speaker track. Reads `AudioFrame` objects from the `AudioStream` async iterator, converts `Int16Array` data to `Buffer`, and sends to Deepgram WebSocket. Handles `is_final` results by inserting to DB and broadcasting.
**When to use:** One instance per subscribed audio track.

```typescript
// Source: @deepgram/sdk v5 docs (deepgram.com/docs/live-streaming-audio) + AudioFrame.data verified
// lib/transcription/deepgram-connection.ts
import { createClient, type DeepgramClient } from '@deepgram/sdk';
import type { AudioStream } from '@livekit/rtc-node';
import { getPool } from '@/lib/db/pool';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeDebateTimeMmss } from './debate-time';

export class DeepgramLiveConnection {
  private dgClient: DeepgramClient;
  private connection: ReturnType<DeepgramClient['listen']['v1']['connect']> | null = null;
  private stopped = false;

  constructor(
    private readonly debateId: string,
    private readonly speakerId: string,      // listening.debate_speakers.id
    private readonly identity: string,       // LiveKit participant identity
    private readonly audioStream: AudioStream,
    private readonly debateActualStart: Date,
  ) {
    this.dgClient = createClient(process.env.DEEPGRAM_API_KEY!);
  }

  async start(): Promise<void> {
    await this.connectDeepgram();
    this.streamAudio(); // fire-and-forget; errors handled internally
  }

  private async connectDeepgram(): Promise<void> {
    this.connection = this.dgClient.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      interim_results: 'true',
      smart_format: 'false',  // verbatim civic record — no smart formatting
      punctuate: 'false',     // verbatim
      filler_words: 'true',   // keep um, uh, like exactly as spoken
    });

    this.connection.on('message', async (data) => {
      if (data.type !== 'Results') return;
      const alternative = data.channel?.alternatives?.[0];
      if (!alternative?.transcript) return;

      if (data.is_final) {
        await this.onFinalTranscript(alternative.transcript, alternative.confidence, alternative.words);
      }
      // Interim results are broadcast separately (no DB insert) — see Pattern 3
      if (!data.is_final) {
        await this.broadcastInterim(alternative.transcript, this.identity);
      }
    });

    this.connection.on('error', (err) => {
      console.error('[deepgram] connection error:', err);
    });

    this.connection.on('close', () => {
      if (!this.stopped) {
        // Reconnect with exponential backoff — see Pattern 4
        this.scheduleReconnect();
      }
    });

    this.connection.connect();
    await this.connection.waitForOpen();
  }

  private async streamAudio(): Promise<void> {
    try {
      for await (const frame of this.audioStream) {
        if (this.stopped) break;
        if (!this.connection) continue;

        // AudioFrame.data is Int16Array (PCM s16le, 48kHz, 1 or 2 channels)
        // Deepgram accepts raw PCM — send as Buffer
        const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
        this.connection.socket.send(pcmBuffer);
      }
    } catch (err) {
      console.error('[deepgram] audio stream error:', err);
    }
  }

  private async onFinalTranscript(
    text: string,
    confidence: number,
    words: Array<{ word: string; start: number; confidence: number }>,
  ): Promise<void> {
    const INAUDIBLE_THRESHOLD = 0.20;  // below this confidence, word is flagged [inaudible]
    const UNAVAILABLE_THRESHOLD = 0.10; // below this overall, flag whole segment [Transcription unavailable]

    if (confidence < UNAVAILABLE_THRESHOLD) {
      // Entire chunk too low quality — store with marker
      text = '[Transcription unavailable]';
    } else {
      // Replace individual very-low-confidence words
      text = words
        .map(w => w.confidence < INAUDIBLE_THRESHOLD ? '[inaudible]' : w.word)
        .join(' ');
    }

    const spokenAt = new Date();
    const pool = getPool();

    await pool.query(
      `INSERT INTO listening.transcript_entries
         (debate_id, segment_id, speaker_id, spoken_at, debate_time_mmss, text, confidence_score)
       VALUES ($1,
         (SELECT id FROM listening.debate_segments WHERE debate_id = $1 AND status = 'active' LIMIT 1),
         $2, $3, $4, $5, $6)`,
      [
        this.debateId,
        this.speakerId,
        spokenAt,
        computeDebateTimeMmss(this.debateActualStart, spokenAt),
        text,
        confidence,
      ],
    );

    // Broadcast the committed entry for live observer display
    await this.broadcastFinal(text, spokenAt);
  }

  stop(): void {
    this.stopped = true;
    this.connection?.finish?.();
    this.connection = null;
  }
}
```

### Pattern 3: Supabase Realtime Broadcast — Worker to Observer

**What:** The worker uses the Supabase admin client's Realtime broadcast REST API (no WebSocket from worker side) to push transcript events. Observers subscribe to the broadcast channel.
**When to use:** After every Deepgram `is_final` result (final transcript) and for interim results.

```typescript
// Source: https://supabase.com/docs/guides/realtime/broadcast
// WORKER SIDE (Node.js API route or worker process) — sends without subscribing
// lib/transcription/deepgram-connection.ts (within the class)

import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Channel name: transcript-${debateId}
// Events: 'interim' and 'final'

private async broadcastFinal(text: string, spokenAt: Date): Promise<void> {
  const supabase = getSupabaseAdmin();
  const channel = supabase.channel(`transcript-${this.debateId}`);
  await channel.send({
    type: 'broadcast',
    event: 'final',
    payload: {
      speakerId: this.speakerId,
      text,
      spokenAt: spokenAt.toISOString(),
      debateTimeMmss: computeDebateTimeMmss(this.debateActualStart, spokenAt),
    },
  });
  supabase.removeChannel(channel);
}

private async broadcastInterim(text: string, identity: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const channel = supabase.channel(`transcript-${this.debateId}`);
  await channel.send({
    type: 'broadcast',
    event: 'interim',
    payload: { identity, text },
  });
  supabase.removeChannel(channel);
}
```

```typescript
// OBSERVER SIDE (React client component) — subscribes to receive events
// hooks/useTranscriptSync.ts
'use client';
import { useEffect, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export interface FinalEntry {
  speakerId: string;
  text: string;
  spokenAt: string;
  debateTimeMmss: string;
}

export interface InterimEntry {
  identity: string;
  text: string;
}

export function useTranscriptSync(
  debateId: string,
  onFinal: (entry: FinalEntry) => void,
  onInterim: (entry: InterimEntry) => void,
): void {
  const stableFinal = useCallback(onFinal, []);    // eslint-disable-line
  const stableInterim = useCallback(onInterim, []); // eslint-disable-line

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`transcript-${debateId}`)
      .on('broadcast', { event: 'final' }, (payload) => {
        stableFinal(payload.payload as FinalEntry);
      })
      .on('broadcast', { event: 'interim' }, (payload) => {
        stableInterim(payload.payload as InterimEntry);
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [debateId, stableFinal, stableInterim]);
}
```

### Pattern 4: Worker Crash / Reconnection Recovery

**What:** The transcription worker is triggered by the debate start. It must handle: (a) Deepgram WebSocket drops; (b) LiveKit room disconnection; (c) worker process restart.
**When to use:** Implemented within the worker.

**Deepgram WebSocket drop:**
- On `close` event while not intentionally stopped, reconnect with exponential backoff (1s, 2s, 4s, 8s, 30s cap)
- Create a fresh `connection` — do NOT reuse the old one
- Timestamp offset: track `workerStartTime` and the offset accumulated from prior connections so `debate_time_mmss` remains accurate (Deepgram resets timestamps on reconnect)
- Gap in transcript: after reconnect succeeds, insert a marker entry with text `'[Transcription unavailable — brief connection issue]'` attributed to the speaker at the gap timestamp

**LiveKit room disconnection:**
- On `RoomEvent.Disconnected`, stop all Deepgram connections, then reconnect the room after 2s delay
- After room reconnect, the `TrackSubscribed` events fire again — the normal startup path resumes

**Worker API route:**
The worker is a long-lived process inside a Next.js API route using the Node.js runtime (not Edge). Start with `POST /api/debates/[debateId]/transcription/start`, stop with `POST /api/debates/[debateId]/transcription/stop`. The worker process lives for the duration of the debate in the Render server memory.

**Note:** Render's free tier does not support persistent WebSocket connections in API routes — but Render's paid tier (already used for this project) does support long-running requests and WebSocket connections. Verify this is not a constraint.

```typescript
// Exponential backoff helper
function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

// In DeepgramLiveConnection:
private reconnectAttempt = 0;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

private scheduleReconnect(): void {
  const delay = backoffMs(this.reconnectAttempt++);
  this.reconnectTimer = setTimeout(async () => {
    try {
      await this.connectDeepgram();
      this.reconnectAttempt = 0; // reset on success
      // Resume streaming — audioStream iteration is already running
    } catch (err) {
      console.error('[deepgram] reconnect failed:', err);
      this.scheduleReconnect();
    }
  }, delay);
}
```

### Pattern 5: debate_time_mmss Computation

**What:** `debate_time_mmss` is formatted as `mm:ss` from the debate's `actual_start` and the moment the word was spoken.
**When to use:** In the worker for every transcript entry insert.

```typescript
// lib/transcription/debate-time.ts
export function computeDebateTimeMmss(actualStart: Date, spokenAt: Date): string {
  const elapsedMs = spokenAt.getTime() - actualStart.getTime();
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
```

### Pattern 6: Live Transcript Panel — Interim + Final Display

**What:** The observer transcript panel renders a list of final entries (from DB snapshot on load + broadcast events) and up to two floating interim entries (one per speaker). When a final result arrives for a speaker, the interim entry for that speaker is replaced.
**When to use:** In the `TranscriptPanel` component.

```typescript
// components/transcript/TranscriptPanel.tsx
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranscriptSync } from '@/hooks/useTranscriptSync';
import { TranscriptEntry } from './TranscriptEntry';

interface TranscriptPanelProps {
  debateId: string;
  initialEntries: FinalEntry[];      // loaded from DB on page load
  speakers: Record<string, { displayName: string; role: 'affirmative' | 'negative' }>;
  segments: DebateSegmentRow[];
}

export function TranscriptPanel({ debateId, initialEntries, speakers, segments }: TranscriptPanelProps) {
  const [entries, setEntries] = useState<FinalEntry[]>(initialEntries);
  // interims keyed by speakerId — at most 2 concurrent (CX)
  const [interims, setInterims] = useState<Record<string, string>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const isFollowingLive = useRef(true);

  const onFinal = useCallback((entry: FinalEntry) => {
    setEntries(prev => [...prev, entry]);
    // Remove interim for this speaker once final arrives
    setInterims(prev => {
      const next = { ...prev };
      // Find speakerId that matches identity → look up by speakerId
      delete next[entry.speakerId];
      return next;
    });
    if (isFollowingLive.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  const onInterim = useCallback((entry: InterimEntry) => {
    // identity → speakerId lookup via speakers prop
    setInterims(prev => ({ ...prev, [entry.identity]: entry.text }));
  }, []);

  useTranscriptSync(debateId, onFinal, onInterim);

  // Auto-scroll: pause on manual scroll-up; "Back to live" button restores
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      isFollowingLive.current = atBottom;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
        {/* Render segment headers and entries in chronological order */}
        {entries.map((entry, i) => (
          <TranscriptEntry key={i} entry={entry} speaker={speakers[entry.speakerId]} />
        ))}
        {/* Interim entries at the bottom — italic, lighter */}
        {Object.entries(interims).map(([id, text]) => (
          <div key={id} className="text-slate-400 italic text-sm">{text}</div>
        ))}
      </div>
      {/* "Back to live" button — only shown when not following live */}
      <BackToLiveButton
        visible={!isFollowingLive.current}
        onClick={() => {
          isFollowingLive.current = true;
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
```

### Pattern 7: Moderator Transcript Correction — SECURITY DEFINER RPC

**What:** Inline click-to-edit on `/moderator/debates/[id]/transcript`. The moderator clicks text, edits, saves. The API calls a SECURITY DEFINER RPC that verifies the caller is the debate moderator, stores the original text in a separate column, and sets `edited = true` with `edited_by` and `edited_at`.
**When to use:** POST-debate only; the route requires `debate.status === 'completed'`.

```sql
-- supabase/migrations/04-transcription_rpcs.sql
CREATE OR REPLACE FUNCTION listening.correct_transcript_entry(
  p_entry_id uuid,
  p_new_text text,
  p_editor_user_id uuid,
  p_debate_id uuid
)
RETURNS listening.transcript_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry listening.transcript_entries;
BEGIN
  -- Verify caller is the debate moderator
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id
      AND user_id = p_editor_user_id
      AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  -- Verify debate is completed (no live editing)
  IF NOT EXISTS (
    SELECT 1 FROM listening.debates
    WHERE id = p_debate_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Cannot edit transcript of an active or scheduled debate';
  END IF;

  -- Store original if first edit
  UPDATE listening.transcript_entries
  SET
    original_text = CASE WHEN edited = false THEN text ELSE original_text END,
    text = p_new_text,
    edited = true,
    edited_at = NOW(),
    edited_by = p_editor_user_id
  WHERE id = p_entry_id AND debate_id = p_debate_id
  RETURNING * INTO v_entry;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transcript entry not found';
  END IF;

  RETURN v_entry;
END;
$$;
```

**Migration note:** The `transcript_entries` table needs an `original_text text` column added in the Phase 4 migration. The Phase 1 schema does not include it.

### Anti-Patterns to Avoid

- **Using `livekit-client` for the backend worker:** `livekit-client` is browser-only (it uses browser WebRTC APIs). Use `@livekit/rtc-node` for server-side track subscription.
- **Relying on Deepgram diarization for speaker attribution:** The project uses separate per-speaker LiveKit tracks — speaker identity is known from track subscription, not from Deepgram's speaker field. Deepgram diarization adds cost and complexity for no benefit here.
- **Disabling `filler_words`:** The spec requires verbatim civic record. Deepgram's `smart_format` and `punctuate` options should be `false`; `filler_words` should be `true` so "um," "uh," "like" are preserved exactly.
- **Single Deepgram connection for both speakers:** Use one Deepgram WebSocket per audio track (per speaker). Mixing audio streams into one connection loses per-speaker attribution.
- **Inserting interim results into the database:** Only `is_final` results are stored in `listening.transcript_entries`. Interim results are broadcast-only (ephemeral display).
- **Using `@supabase/supabase-js` PostgREST for transcript writes:** PostgREST does not expose the `listening` schema. All inserts go through `pool.query()`.
- **Forgetting `original_text` column:** The RPC cannot store the original text if the column doesn't exist. Migration must add it before the RPC is created.
- **Starting the worker inside an Edge runtime API route:** `@livekit/rtc-node` uses native Node.js WebRTC bindings. The API route must be in the Node.js runtime. Add `export const runtime = 'nodejs';` to the route.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket keepalive for Deepgram | Custom ping interval | Deepgram SDK connection handles keepalive | SDK manages the WS lifecycle; sending audio data is itself a keepalive |
| Audio resampling | Custom PCM resampling code | Pass `sampleRate` param to `AudioStream` constructor | `new AudioStream(track, 16000)` resamples to the rate Deepgram expects; no manual resampling needed |
| FTS indexing | Custom search table or Elasticsearch | Existing GIN index on `transcript_entries` | Phase 1 already created `CREATE INDEX ... USING gin (to_tsvector('english', text))` — it's done |
| Transcript entry pagination | Custom cursor | Standard `LIMIT/OFFSET` or `spoken_at > ?` cursor | Transcript is append-only; cursor on `spoken_at` is efficient with the existing index |
| Inline edit state management | Complex edit state store | Local component state (useState) | Only one entry is being edited at a time; no global state needed |

**Key insight:** The schema (`transcript_entries`), RLS policies, FTS index, and channel patterns are already established. The worker is the novel piece; the storage and delivery infrastructure is mostly reuse.

---

## Common Pitfalls

### Pitfall 1: `@livekit/rtc-node` is Not `livekit-client`

**What goes wrong:** Attempting to use `livekit-client` in a Node.js worker process → `ReferenceError: window is not defined` or WebRTC API not found.
**Why it happens:** `livekit-client` uses browser WebRTC APIs (`RTCPeerConnection`, `MediaStream`, etc.) that don't exist in Node.js.
**How to avoid:** Use `@livekit/rtc-node` for all server-side room connections. `@livekit/rtc-node` is a separate package using native Rust-based WebRTC bindings compiled for Node.js.
**Warning signs:** `ReferenceError: RTCPeerConnection is not defined` at import time.

### Pitfall 2: `AudioFrame.data` is `Int16Array` — Deepgram wants `Buffer`

**What goes wrong:** Sending `frame.data` (an `Int16Array`) directly to Deepgram WebSocket → Deepgram returns garbled transcripts or connection closes.
**Why it happens:** `connection.socket.send()` with a typed array may not send the underlying buffer correctly depending on the environment.
**How to avoid:** Always convert: `const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);` then send `pcmBuffer`. This correctly wraps the Int16Array's underlying ArrayBuffer.
**Warning signs:** Deepgram returns empty transcripts or NET errors on the connection.

### Pitfall 3: Deepgram Timestamp Reset on Reconnect

**What goes wrong:** After a reconnect, Deepgram `word.start` resets to 0. `debate_time_mmss` values for post-reconnect entries are wrong (they appear to be from the debate start).
**Why it happens:** Each Deepgram WebSocket connection is independent. Timestamps are relative to the start of THAT connection, not the debate.
**How to avoid:** Track `connectionStartWallTime` at the moment each Deepgram connection opens. For every transcript result, compute `debate_time_mmss` from wall clock (`Date.now()`) not from Deepgram's `word.start` timestamps. Use Deepgram word timestamps only for intra-result ordering within a single utterance.
**Warning signs:** Post-reconnect entries show timestamps starting from `00:00`.

### Pitfall 4: Worker Process Is Not Persistent Between Requests

**What goes wrong:** The transcription worker starts but is lost when the Render instance handles a different request (serverless-style ephemeral process).
**Why it happens:** Next.js API routes on Render are long-running Node.js processes (not serverless), but the worker object must be stored somewhere persistent in the process. Module-level singletons work but can be lost on Render restart.
**How to avoid:** Store the active worker in a module-level Map keyed by `debateId`. On Render, the Node.js process is persistent between requests for the lifetime of the deployment. Add health check: `GET /api/debates/[debateId]/transcription/status` returns whether the worker is active.
**Warning signs:** Transcript entries stop appearing after several minutes; worker Map is empty despite no explicit stop call.

### Pitfall 5: Supabase Broadcast Channel Not Subscribed Before Events Arrive

**What goes wrong:** Observer subscribes to the broadcast channel after the debate starts; misses some transcript entries that were broadcast before the subscription was set up.
**Why it happens:** Broadcast is ephemeral — messages sent before subscription are not delivered retroactively.
**How to avoid:** On page load, fetch the existing transcript history from the DB (`GET /api/debates/[debateId]/transcript`) and render it first, THEN subscribe to the broadcast channel. This ensures no gap. The existing `useObserverDebateSync` pattern (snapshot + realtime) is the correct mental model.
**Warning signs:** Transcript panel is missing entries from the early debate when an observer joins mid-debate.

### Pitfall 6: Next.js API Route Must Declare Node.js Runtime

**What goes wrong:** The transcription worker API route crashes at startup with `Module not found: @livekit/rtc-node` or native binding errors.
**Why it happens:** Next.js defaults some routes to the Edge runtime, which cannot use native Node.js bindings.
**How to avoid:** Add `export const runtime = 'nodejs';` at the top of any route file that uses `@livekit/rtc-node` or `@deepgram/sdk`.
**Warning signs:** The route works locally (Node.js dev server) but fails on Render's production build.

### Pitfall 7: `DEEPGRAM_API_KEY` Not in `env.ts`

**What goes wrong:** `process.env.DEEPGRAM_API_KEY` is `undefined` at runtime; Deepgram client throws on first connection attempt.
**Why it happens:** The `lib/env.ts` schema does not include `DEEPGRAM_API_KEY` (verified: it only has MUX, LiveKit, AWS, and Supabase vars). The key was provisioned in 01-02 but never added to the env schema.
**How to avoid:** Add `DEEPGRAM_API_KEY: z.string().min(1)` to `lib/env.ts` schema before writing the worker. Use `env.DEEPGRAM_API_KEY` (not `process.env.DEEPGRAM_API_KEY`) throughout.
**Warning signs:** `Error: Deepgram API key is required` at `new DeepgramClient()` construction.

### Pitfall 8: `is_final` vs `speech_final` Distinction

**What goes wrong:** Worker stores partial transcript entries with incomplete sentences, or waits too long before storing anything.
**Why it happens:** Deepgram streams two distinct finalization signals:
- `is_final: true` — this utterance window is committed; Deepgram will not revise it. (Can still be mid-sentence)
- `speech_final: true` — a speech-pause endpoint was detected; this is the "natural break" signal
**How to avoid:** Use `is_final: true` as the trigger for DB insert. `speech_final` is a hint for sentence segmentation but is optional. For a verbatim civic record, `is_final` per-chunk is sufficient and produces fine-grained entries.
**Warning signs:** Transcript shows very long entries (if waiting only for `speech_final`) or very fragmented entries (if using neither correctly).

### Pitfall 9: Segment ID Join Must Use `actual_start IS NOT NULL`

**What goes wrong:** The `SELECT id FROM listening.debate_segments WHERE debate_id = $1 AND status = 'active'` query returns null because a segment is in `paused` state (prep time in progress).
**Why it happens:** During prep time, segment `status = 'paused'`, not `'active'`.
**How to avoid:** Use `status IN ('active', 'paused')` in the segment lookup. During prep time, the speaker is not speaking, so transcript entries are unlikely — but if they do speak (e.g., off-mic), the entry should still be attributed to the correct segment.
**Warning signs:** `segment_id` column is null on transcript entries created during prep time transitions.

---

## Code Examples

### Deepgram SDK v5 — Live Connection with Nova-3

```typescript
// Source: deepgram.com/docs/live-streaming-audio (verified 2026-04-22)
import { createClient } from '@deepgram/sdk';

const client = createClient(env.DEEPGRAM_API_KEY);

const connection = client.listen.v1.connect({
  model: 'nova-3',
  language: 'en',
  interim_results: 'true',
  smart_format: 'false',
  punctuate: 'false',
  filler_words: 'true',
  encoding: 'linear16',  // PCM s16le from AudioFrame.data
  sample_rate: '48000',  // AudioStream default; or pass 16000 if resampled
  channels: '1',
});

connection.on('open', () => console.log('[deepgram] connection open'));
connection.on('message', (data) => {
  if (data.type !== 'Results') return;
  const alt = data.channel?.alternatives?.[0];
  if (!alt) return;
  console.log({
    is_final: data.is_final,
    speech_final: data.speech_final,
    transcript: alt.transcript,
    confidence: alt.confidence,
    words: alt.words,  // array of { word, start, end, confidence }
  });
});
connection.on('error', console.error);
connection.on('close', () => console.log('[deepgram] connection closed'));

connection.connect();
await connection.waitForOpen();

// Send PCM buffer:
connection.socket.send(pcmBuffer);

// Close when done:
connection.finish();
```

### @livekit/rtc-node — Room Connect + Audio Subscribe

```typescript
// Source: docs.livekit.io/reference/client-sdk-node/ (verified 2026-04-22)
import {
  Room, RoomEvent, TrackKind, AudioStream,
  type RemoteTrack, type RemoteParticipant,
} from '@livekit/rtc-node';

const room = new Room();

room.on(RoomEvent.TrackSubscribed, async (
  track: RemoteTrack,
  _pub: unknown,
  participant: RemoteParticipant,
) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;

  // AudioStream with optional resampling:
  // new AudioStream(track, 16000) → resample to 16kHz for Deepgram
  const stream = new AudioStream(track);

  for await (const frame of stream) {
    // frame.data  → Int16Array (raw PCM)
    // frame.sampleRate  → number (e.g. 48000)
    // frame.channels  → number (1 = mono)
    // frame.samplesPerChannel  → number
    const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    dgConnection.socket.send(buf);
  }
});

await room.connect(process.env.LIVEKIT_URL!, workerToken, { autoSubscribe: true });
```

### Worker Token Minting

The existing `mintToken` in `lib/livekit/tokens.ts` needs a 'worker' role added:

```typescript
// lib/livekit/tokens.ts — add 'worker' to the ParticipantRole type
export type ParticipantRole = 'speaker' | 'moderator' | 'worker';

// In the VideoGrant:
canPublish: role === 'speaker',
canSubscribe: true,              // worker subscribes to all tracks
canPublishData: false,           // worker does not send data messages
roomAdmin: false,                // worker has no admin rights
```

### Supabase Realtime Broadcast — Server-Side Send (No Persistent WS)

```typescript
// Source: supabase.com/docs/guides/realtime/broadcast (verified 2026-04-22)
// Sending a broadcast without subscribing — uses HTTP under the hood
const supabase = getSupabaseAdmin();
const channel = supabase.channel(`transcript-${debateId}`);

await channel.send({
  type: 'broadcast',
  event: 'final',
  payload: { speakerId, text, spokenAt, debateTimeMmss },
});

supabase.removeChannel(channel); // clean up immediately; no subscription needed
```

### transcript_entries Schema (Existing) + `original_text` Addition

```sql
-- Existing (Phase 1) — DO NOT recreate; just reference:
-- CREATE TABLE listening.transcript_entries (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   debate_id uuid REFERENCES listening.debates(id) ON DELETE CASCADE,
--   segment_id uuid REFERENCES listening.debate_segments(id),
--   speaker_id uuid REFERENCES listening.debate_speakers(id),
--   spoken_at timestamptz NOT NULL,
--   debate_time_mmss text NOT NULL,
--   text text NOT NULL,
--   confidence_score numeric(3,2),
--   character_start integer,      -- Phase 1: reserved for future word-level use
--   character_end integer,        -- Phase 1: reserved for future word-level use
--   edited boolean DEFAULT false,
--   edited_at timestamptz,
--   edited_by uuid REFERENCES auth.users(id)
-- );
-- CREATE INDEX ON listening.transcript_entries(debate_id, spoken_at);
-- CREATE INDEX ON listening.transcript_entries USING gin (to_tsvector('english', text));

-- Phase 4 migration must ADD:
ALTER TABLE listening.transcript_entries
  ADD COLUMN IF NOT EXISTS original_text text;  -- stores pre-edit verbatim Deepgram output

-- Phase 4 migration must also ADD publication for Realtime (if not already done):
ALTER PUBLICATION supabase_realtime ADD TABLE listening.transcript_entries;
GRANT SELECT ON listening.transcript_entries TO authenticated, anon;
ALTER TABLE listening.transcript_entries REPLICA IDENTITY FULL;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deepgram Nova-2 (assumed) | Deepgram Nova-3 (recommended) | Nova-3 GA: Feb 2025 | 25% reduction in WER; slightly higher cost ($0.0077 vs $0.0058/min) |
| Deepgram JS SDK v3 (`dgConnection.on(LiveTranscriptionEvents.Transcript, ...)`) | SDK v5 (`connection.on('message', ...)` + `data.type === 'Results'`) | SDK v5: Mar 2026 | Breaking change in event API; old `LiveTranscriptionEvents` enum gone |
| Browser `livekit-client` for all LiveKit operations | `@livekit/rtc-node` for server-side participants | @livekit/rtc-node reached 0.13.x | Dedicated server SDK with native Node.js WebRTC; browser SDK cannot be used server-side |

**Deprecated/outdated:**
- Deepgram SDK v3 `LiveTranscriptionEvents.Transcript` enum — removed in v5; use `data.type === 'Results'` check
- Nova-2-meeting model for per-speaker tracks — irrelevant (that model targets a single mic with multiple speakers; this project has separate tracks)

---

## Open Questions

1. **`@livekit/rtc-node` AudioStream sample rate**
   - What we know: `new AudioStream(track)` yields frames at the track's native sample rate (typically 48kHz for WebRTC). `new AudioStream(track, 16000)` resamples to 16kHz.
   - What's unclear: Deepgram Nova-3 accepts 16kHz (standard) and potentially 48kHz (with `sample_rate` parameter). Whether passing 48kHz raw or 16kHz resampled produces better results is untested.
   - Recommendation: Start with `new AudioStream(track, 16000)` (16kHz mono) and set `encoding: 'linear16'`, `sample_rate: '16000'` in Deepgram params. This is the standard speech recognition sample rate and is well-supported.

2. **Long-running worker in Render's Node.js process**
   - What we know: Render's paid tier runs a persistent Node.js process. The worker stores state in module-level Maps.
   - What's unclear: Whether Render auto-restarts the process during deployments and whether the worker handles graceful shutdown.
   - Recommendation: On debate start, also store the active debate ID in the DB (`debate.transcription_worker_active = true`). On startup, check for in-progress debates and restart any orphaned workers. This is a resilience measure for Render restarts mid-debate.
   - Schema impact: May need `transcription_active boolean DEFAULT false` column on `listening.debates` — but this can be inferred from `status = 'live'` if worker startup is part of debate go-live flow.

3. **`connection.socket.send` vs `connection.sendMedia`**
   - What we know: Deepgram SDK v5 docs show `connection.socket.send(audioData)` for sending audio. An older API had `dgConnection.send()`.
   - What's unclear: Whether `connection.sendMedia(buffer)` exists as a higher-level API in v5.
   - Recommendation: Verify from the installed `@deepgram/sdk` TypeScript types after `npm install`. If `sendMedia()` exists and is typed for Buffer input, prefer it. Otherwise use `connection.socket.send(pcmBuffer)`.

4. **Supabase Broadcast rate limits**
   - What we know: Supabase Broadcast via REST has no documented per-message rate limit for the paid tier.
   - What's unclear: Whether sending one HTTP broadcast per Deepgram `is_final` result (roughly 1-3 per second per speaker) will cause throttling. Two concurrent speakers in CX = 2-6 broadcasts/second.
   - Recommendation: This rate should be well within Supabase's limits. If throttling occurs, batch interim results (send every 500ms instead of per-result) while keeping final results unbatched.

5. **Moderator transcript page auth pattern**
   - What we know: The moderator page at `/moderator/debates/[id]/transcript` requires auth. The existing pattern uses `verifyToken` + pool query to check `listening_moderator` role.
   - What's unclear: Whether the server component at that route can call the SECURITY DEFINER RPC via `pool.query()` or needs to use the Supabase admin client.
   - Recommendation: Use `pool.query()` for the RPC call (`SELECT * FROM listening.correct_transcript_entry(...)`) — this is the established pattern for all `listening` schema writes.

---

## Sources

### Primary (HIGH confidence)
- `C:\Empowered Listening\supabase\migrations\20260420000000_create_listening_schema.sql` — `transcript_entries` schema confirmed; `original_text` column confirmed absent
- `C:\Empowered Listening\supabase\migrations\20260420000001_listening_rls_policies.sql` — RLS policies confirmed (anon + authenticated SELECT on transcript_entries)
- `C:\Empowered Listening\lib\env.ts` — confirmed `DEEPGRAM_API_KEY` is missing from schema
- `C:\Empowered Listening\package.json` — confirmed `@livekit/rtc-node` and `@deepgram/sdk` are not yet installed
- `docs.livekit.io/reference/client-sdk-node/` — `@livekit/rtc-node` v0.13.25; AudioStream, AudioFrame.data as Int16Array
- `docs.livekit.io/reference/client-sdk-node/classes/AudioFrame.html` — AudioFrame.data is `Int16Array`; sampleRate, channels, samplesPerChannel properties
- `supabase.com/docs/guides/realtime/broadcast` — REST broadcast API (send without subscribing); client subscription API
- `developers.deepgram.com/reference/speech-to-text/listen-streaming` — Deepgram streaming API: is_final, speech_final, confidence, words array
- `github.com/deepgram/deepgram-js-sdk` — SDK v5.0.0 released Mar 4 2026; `createClient`, `client.listen.v1.connect()`, `connection.on('message')` events

### Secondary (MEDIUM confidence)
- `deepgram.com/learn/model-comparison-when-to-use-nova-2-vs-nova-3-for-devs` — Nova-3 streaming WER 6.84% vs Nova-2 9.09%; production GA confirmed
- `deepgram.com/pricing` — Nova-3 $0.0077/min, Nova-2 $0.0058/min; $200 free credit
- `developers.deepgram.com/docs/recovering-from-connection-errors-and-timeouts-when-live-streaming-audio` — reconnection strategy; timestamp reset issue; 10-second audio-start requirement
- `docs.livekit.io/transport/media/ingress-egress/egress/track/` — Track Egress as alternative; PCM s16le format confirmed for audio tracks
- `github.com/livekit/node-sdks` — @livekit/rtc-node v0.13.25 confirmed; "Developer Preview mode" caveat noted

### Tertiary (LOW confidence)
- WebSearch: Deepgram SDK v5 event API change (LiveTranscriptionEvents removed) — consistent with GitHub SDK v5.0.0 and multiple sources but not directly verified in official changelog
- WebSearch: Render persistent process behavior for long-running workers — inferred from platform documentation; should be empirically verified before relying on it

---

## Metadata

**Confidence breakdown:**
- Standard stack (Deepgram SDK v5, @livekit/rtc-node, existing Supabase): HIGH — all verified from official docs and package metadata
- Architecture (per-track DeepgramLiveConnection pattern): HIGH — derived directly from official docs and existing codebase patterns
- Deepgram model recommendation (Nova-3): HIGH — official comparison doc verified; pricing confirmed
- Worker crash/reconnect patterns: MEDIUM — Deepgram docs confirm the principle; exact SDK v5 event names verified from multiple sources
- Supabase broadcast rate limits: LOW — not officially documented; flagged as open question

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (verify @livekit/rtc-node and @deepgram/sdk versions before install; both are actively developed)
