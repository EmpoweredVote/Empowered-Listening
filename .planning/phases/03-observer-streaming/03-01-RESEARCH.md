# Phase 03-01: LiveKit Egress + Mux RTMP Pipeline - Research

**Researched:** 2026-04-21
**Domain:** LiveKit Egress (RoomCompositeEgress), Mux Live Streaming API, RTMP pipeline lifecycle
**Confidence:** HIGH (SDK source read directly from node_modules; LiveKit docs fetched; Mux docs fetched)

---

## Summary

Phase 03-01 wires a LiveKit RoomCompositeEgress job to a Mux live stream via RTMP.  The pipeline starts
when the moderator calls `POST /api/debates/[debateId]/segments/[segmentId]` with `action='start'` (which
already sets `debates.status='live'`) and stops when `action='end'` on the last segment transitions
status to `'completed'`.

The standard approach is:

1. Create a Mux live stream via `@mux/mux-node` SDK at debate-creation time (or lazily at start time).
   This returns `id`, `stream_key`, and `playback_ids[0].id`.  Store all three on `listening.debates`.
2. On debate start, call `EgressClient.startRoomCompositeEgress()` with a `StreamOutput` using the
   LiveKit-native `mux://<stream_key>` URL shorthand.  Store the returned `egress_id` on the debate row.
3. On debate end, call `EgressClient.stopEgress(egressId)` then `mux.video.liveStreams.complete(muxStreamId)`.

Both SDKs are already available (`livekit-server-sdk` v2.15.1 is installed; `@mux/mux-node` needs to be
added).  All fields can live on `listening.debates` with an ALTER TABLE migration — no separate table needed.

**Primary recommendation:** Start egress synchronously inside the existing segment-start API route (not
fire-and-forget, not a webhook).  Use `listEgress({roomName, active: true})` before starting to achieve
idempotency on retries.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `livekit-server-sdk` | 2.15.1 (already installed) | `EgressClient`, `StreamOutput`, `StreamProtocol` | Official LiveKit server SDK |
| `@mux/mux-node` | ^9+ (needs install) | `mux.video.liveStreams.create/complete/delete` | Official Mux server SDK |

### Supporting — already in project

| Library | Purpose |
|---------|---------|
| `pg` (pool.query) | Storing egress_id + mux IDs on debate row |
| `lib/env.ts` (zod schema) | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` already declared optional |
| `lib/livekit/room-service.ts` | Pattern for lazy singleton clients — replicate for `EgressClient` |

### Installation

```bash
npm install @mux/mux-node
```

No other new packages needed.

---

## Architecture Patterns

### Where to Store IDs

Add three columns to `listening.debates` via a migration:

```sql
ALTER TABLE listening.debates
  ADD COLUMN IF NOT EXISTS mux_stream_id   text,
  ADD COLUMN IF NOT EXISTS mux_playback_id text,
  ADD COLUMN IF NOT EXISTS mux_stream_key  text,
  ADD COLUMN IF NOT EXISTS livekit_egress_id text;
```

**Rationale:** These are 1:1 with a debate.  A separate table adds no value and complicates queries.
The existing `cloudflare_stream_id text` column is the precedent — Mux replaces it.

### Timing: When to Create the Mux Live Stream

Two valid approaches:

**Option A — At debate creation** (`POST /api/debates`):
- Pro: Playback URL available immediately for pre-event pages.
- Con: Wastes a Mux stream if the debate is cancelled.

**Option B — At segment start (first action='start')**:
- Pro: No orphaned streams.
- Con: Adds latency to the moderator's start tap.  Creation + egress start together take ~1-3s.

**Recommendation: Option B** (at segment start).  Civic debates are never cancelled after the room
is live.  The 1-3s extra latency on start is acceptable.  If a pre-event player URL is needed before
Phase 03-02, this can be revisited.

### Trigger: Synchronous in the API Route

Start egress inside the existing `action='start'` branch of
`/api/debates/[debateId]/segments/[segmentId]/route.ts`, after `startSegment()` succeeds.  Do NOT
make it fire-and-forget — capture the egress ID and persist it.  The route should:

1. Check `debate.livekit_egress_id` is null (idempotency guard — see Pitfalls).
2. Create Mux live stream → get `mux_stream_id`, `mux_stream_key`, `mux_playback_id`.
3. Persist those three to `listening.debates`.
4. Call `EgressClient.startRoomCompositeEgress()` → get `egress_id`.
5. Persist `livekit_egress_id` to `listening.debates`.

Stop egress inside the `action='end'` branch when `debate.status` transitions to `'completed'` (i.e.,
only on the last segment end).  The route should:

1. Read `debate.livekit_egress_id` and `debate.mux_stream_id`.
2. Call `EgressClient.stopEgress(egressId)`.
3. Call `mux.video.liveStreams.complete(muxStreamId)`.
4. Null out `livekit_egress_id` on the debate row.

### Recommended Project Structure

```
lib/
├── livekit/
│   ├── room-service.ts      (existing)
│   └── egress-service.ts    (new — EgressClient singleton + startDebateEgress/stopDebateEgress)
├── mux/
│   └── client.ts            (new — Mux client singleton + createLiveStream/completeStream)
supabase/migrations/
└── 20260421XXXXXX_add_mux_egress_columns.sql   (new)
```

---

## Standard API Calls — Verified from Source

### EgressClient: Start RoomCompositeEgress

**Source:** `node_modules/livekit-server-sdk/dist/EgressClient.d.ts` (read directly)

```typescript
import { EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } from 'livekit-server-sdk';

// Singleton pattern (mirror room-service.ts)
let _egressClient: EgressClient | null = null;
export function getEgressClient(): EgressClient {
  if (!_egressClient) {
    _egressClient = new EgressClient(
      env.LIVEKIT_URL,
      env.LIVEKIT_API_KEY,
      env.LIVEKIT_API_SECRET,
    );
  }
  return _egressClient;
}

// Start egress
const egressInfo = await getEgressClient().startRoomCompositeEgress(
  roomName,                        // livekit_room_name from debates table
  new StreamOutput({
    protocol: StreamProtocol.RTMP,
    urls: [`mux://${muxStreamKey}`],  // LiveKit's native Mux shorthand
  }),
  {
    layout: 'speaker',             // built-in: 'speaker' | 'speaker-light' | 'grid' | 'grid-light'
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
  },
);

const egressId: string = egressInfo.egressId;
```

**Key facts (HIGH confidence):**
- `startRoomCompositeEgress` is async and returns `EgressInfo` with `egressId: string`.
- `StreamOutput` takes `protocol` (enum) and `urls` (string[]).
- `StreamProtocol.RTMP` = 1; `StreamProtocol.SRT` = 2.
- Layout string `'speaker'` selects the speaker-focused built-in composite layout.
- `EncodingOptionsPreset.H264_720P_30` = 1280x720 30fps 3000kbps — appropriate for a debate stream.
- `mux://<stream_key>` is the LiveKit-native shorthand documented at `docs.livekit.io/home/egress/outputs/`.
  LiveKit routes this to Mux's RTMP ingest automatically.  Alternatively the full URL works:
  `rtmps://global-live.mux.com:443/app/<stream_key>` (port 443 for RTMPS, 5222 for plain RTMP).

### EgressClient: Stop Egress

```typescript
await getEgressClient().stopEgress(egressId);
```

**Source:** `node_modules/livekit-server-sdk/dist/EgressClient.d.ts`
Returns `EgressInfo`.  Safe to call even if the egress is already stopping.

### EgressClient: List Active Egress (Idempotency Check)

```typescript
const active = await getEgressClient().listEgress({ roomName, active: true });
if (active.length > 0) {
  return active[0].egressId; // already running, reuse
}
```

**Source:** `node_modules/livekit-server-sdk/dist/EgressClient.d.ts` — `ListEgressOptions` has
`roomName?: string` and `active?: boolean`.  Only returns non-completed egress.

### Mux SDK: Create Live Stream

**Source:** Mux docs + mux-node-sdk GitHub (MEDIUM confidence — SDK not yet installed, verified via
official docs and npm package docs)

```typescript
import Mux from '@mux/mux-node';

let _mux: Mux | null = null;
export function getMuxClient(): Mux {
  if (!_mux) {
    _mux = new Mux({
      tokenId: env.MUX_TOKEN_ID!,
      tokenSecret: env.MUX_TOKEN_SECRET!,
    });
  }
  return _mux;
}

// Create live stream at debate start
const stream = await getMuxClient().video.liveStreams.create({
  playback_policies: ['public'],
  new_asset_settings: { playback_policies: ['public'] },
  latency_mode: 'reduced',         // 12-20s delay — good balance for civic debates
  reconnect_window: 0,             // reduced latency default; prevents stale reconnects
});

const muxStreamId   = stream.id;
const muxStreamKey  = stream.stream_key;
const muxPlaybackId = stream.playback_ids![0].id;
// HLS URL: `https://stream.mux.com/${muxPlaybackId}.m3u8`
```

### Mux SDK: Complete Live Stream

```typescript
await getMuxClient().video.liveStreams.complete(muxStreamId);
```

This flushes video buffers, appends `EXT-X-ENDLIST` to the HLS manifest, and creates the VOD asset
from the recording.  It does NOT delete the stream resource.

### Mux RTMP Ingest URL (reference)

| Protocol | URL | Note |
|----------|-----|------|
| RTMPS (secure) | `rtmps://global-live.mux.com:443/app/<stream_key>` | Preferred |
| RTMP | `rtmp://global-live.mux.com:5222/app/<stream_key>` | Port 5222, NOT 1935 |
| LiveKit shorthand | `mux://<stream_key>` | Recommended — LiveKit handles routing |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RTMP compositing | Custom WebRTC-to-RTMP bridge | `EgressClient.startRoomCompositeEgress` | LiveKit Cloud handles Chrome headless compositor, encoding, RTMP push |
| HLS delivery | Custom HLS server | Mux managed HLS | CDN, adaptive bitrate, VOD recording included |
| Egress layout | Custom video layout engine | Built-in `'speaker'` layout | Sufficient for two-speaker debate; custom templates require separate Chromium hosting |
| Stream idempotency | DB-level locks | `listEgress({active:true})` before start | Authoritative source; race-proof |

**Key insight:** LiveKit Cloud egress runs a remote Chromium browser that joins the room and encodes
the composite.  You never run ffmpeg or a compositor — the SDK call is the full solution.

---

## Common Pitfalls

### Pitfall 1: Duplicate Egress on Retry

**What goes wrong:** The segment-start route is called twice (network retry, optimistic UI double-tap).
Each call successfully starts a new egress job, doubling RTMP output to Mux and billing both.

**How to avoid:**
1. Read `debate.livekit_egress_id` before starting — if non-null, skip egress creation.
2. As a belt-and-suspenders backup, call `listEgress({roomName, active: true})` and reuse the existing
   egress ID if one is found.
3. Do these two checks under a short DB advisory lock or accept the tiny race window (very low risk
   since the segment-start route requires moderator auth).

**Warning signs:** Two egress jobs appear in the LiveKit Cloud dashboard for the same room.

### Pitfall 2: mux:// vs Full RTMP URL Protocol Mismatch

**What goes wrong:** Using `StreamProtocol.RTMP` with `mux://` shorthand vs `StreamProtocol.RTMPS`
with the full `rtmps://` URL — the protocol enum does not need to match the shorthand prefix.

**How to avoid:** When using `mux://<key>`, use `StreamProtocol.RTMP` (LiveKit handles the secure
upgrade internally).  When using the full URL, match the protocol enum to the scheme.

### Pitfall 3: Mux Reconnect Window Causes Duplicate VOD Assets

**What goes wrong:** `stopEgress()` disconnects the RTMP feed.  If Mux's reconnect_window > 0, Mux
waits for a reconnect.  If the egress service retries, a second asset is created under the same
stream ID.

**How to avoid:** Set `reconnect_window: 0` when creating the Mux live stream.  With reduced latency
mode, 0 is already the default.  Then call `liveStreams.complete()` after `stopEgress()` to flush
the manifest immediately.

### Pitfall 4: Egress Starts Before Room Exists

**What goes wrong:** `startRoomCompositeEgress` is called before the LiveKit room has any
participants.  The egress compositor starts but the composite is black until the first participant
joins.  This wastes Mux stream minutes.

**How to avoid:** Egress is triggered by `action='start'`, which the moderator can only call
after joining the room.  The room always has at least the moderator present.  No extra guard needed.

### Pitfall 5: stopEgress Called With Stale or Null egressId

**What goes wrong:** Debate ends but `livekit_egress_id` is null in DB (race: egress failed to start
and the field was never written).  `stopEgress(null)` throws or targets wrong job.

**How to avoid:** Read `livekit_egress_id` from DB before stop.  If null, skip `stopEgress()` and
log a warning — the egress already failed or was never started.  Still call `liveStreams.complete()`
if `mux_stream_id` is present to clean up the Mux side.

### Pitfall 6: egress.status Race — STARTING vs ACTIVE

**What goes wrong:** Immediately after calling `startRoomCompositeEgress`, the status is
`EGRESS_STARTING` (0), not `EGRESS_ACTIVE` (1).  Calling `stopEgress` during STARTING will abort
it cleanly but may not flush all data.

**How to avoid:** For a debate this is fine — we never stop egress during the STARTING window (it
takes only seconds for Cloud egress).  If you ever need to poll for ACTIVE status: use `listEgress`
and check `status === EgressStatus.EGRESS_ACTIVE`.

### Pitfall 7: env.ts MUX_TOKEN_ID Optional — Crashes at Runtime

**What goes wrong:** `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` are `z.string().optional()` in `env.ts`.
Creating the Mux client without them causes a runtime error that only surfaces at debate start.

**How to avoid:** Either tighten the Zod schema for Phase 3 environments, or add a runtime guard in
`getMuxClient()`:

```typescript
if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
  throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET are required for egress');
}
```

---

## Code Examples

### Complete startDebateEgress Helper

```typescript
// lib/livekit/egress-service.ts
import 'server-only';
import { EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } from 'livekit-server-sdk';
import { env } from '@/lib/env';

let _egressClient: EgressClient | null = null;

function getEgressClient(): EgressClient {
  if (!_egressClient) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new Error('LiveKit credentials not configured');
    }
    _egressClient = new EgressClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }
  return _egressClient;
}

export async function startDebateEgress(roomName: string, muxStreamKey: string): Promise<string> {
  const client = getEgressClient();

  // Idempotency: check for existing active egress
  const existing = await client.listEgress({ roomName, active: true });
  if (existing.length > 0) return existing[0].egressId;

  const info = await client.startRoomCompositeEgress(
    roomName,
    new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [`mux://${muxStreamKey}`] }),
    { layout: 'speaker', encodingOptions: EncodingOptionsPreset.H264_720P_30 },
  );
  return info.egressId;
}

export async function stopDebateEgress(egressId: string): Promise<void> {
  await getEgressClient().stopEgress(egressId);
}
```

### Complete Mux Client Helper

```typescript
// lib/mux/client.ts
import 'server-only';
import Mux from '@mux/mux-node';
import { env } from '@/lib/env';

let _mux: Mux | null = null;

function getMux(): Mux {
  if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET are required');
  }
  if (!_mux) _mux = new Mux({ tokenId: env.MUX_TOKEN_ID, tokenSecret: env.MUX_TOKEN_SECRET });
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
  return {
    muxStreamId:   stream.id,
    muxStreamKey:  stream.stream_key,
    muxPlaybackId: stream.playback_ids![0].id,
  };
}

export async function completeMuxLiveStream(muxStreamId: string): Promise<void> {
  await getMux().video.liveStreams.complete(muxStreamId);
}
```

### Migration: Add Mux + Egress Columns

```sql
-- supabase/migrations/YYYYMMDDXXXXXX_add_mux_egress_columns.sql
ALTER TABLE listening.debates
  ADD COLUMN IF NOT EXISTS mux_stream_id     text,
  ADD COLUMN IF NOT EXISTS mux_stream_key    text,
  ADD COLUMN IF NOT EXISTS mux_playback_id   text,
  ADD COLUMN IF NOT EXISTS livekit_egress_id text;
```

Note: `cloudflare_stream_id` already exists from the v1 migration.  Leave it in place (no-op column).

### Integration in Segment Start Route (pseudocode)

```typescript
// Inside action === 'start' branch, after startSegment() succeeds:

// 1. Guard: only start egress if this is the first segment (debate transitioning to 'live')
const { rows: [debate] } = await pool.query(
  `SELECT livekit_room_name, livekit_egress_id, mux_stream_id FROM listening.debates WHERE id = $1`,
  [debateId],
);

if (!debate.livekit_egress_id) {
  // 2. Create Mux live stream
  const { muxStreamId, muxStreamKey, muxPlaybackId } = await createMuxLiveStream();

  // 3. Persist Mux fields before starting egress (survive partial failure)
  await pool.query(
    `UPDATE listening.debates SET mux_stream_id=$1, mux_stream_key=$2, mux_playback_id=$3 WHERE id=$4`,
    [muxStreamId, muxStreamKey, muxPlaybackId, debateId],
  );

  // 4. Start LiveKit egress
  const egressId = await startDebateEgress(debate.livekit_room_name, muxStreamKey);

  // 5. Persist egress ID
  await pool.query(
    `UPDATE listening.debates SET livekit_egress_id=$1 WHERE id=$2`,
    [egressId, debateId],
  );
}
```

---

## Schema Impact

The debates table needs four new columns.  All nullable (no backfill needed).

| Column | Type | Written When | Read When |
|--------|------|-------------|-----------|
| `mux_stream_id` | `text` | Debate goes live | Egress stop; Phase 03-02 API |
| `mux_stream_key` | `text` | Debate goes live | Egress start (if restart needed) |
| `mux_playback_id` | `text` | Debate goes live | Phase 03-02 observer API |
| `livekit_egress_id` | `text` | Egress starts; nulled on stop | Egress stop |

`mux_stream_key` is a secret credential.  It is stored server-side only, never returned to clients.
RLS on `listening.debates` already restricts SELECT to participants + public for live/completed debates.
The observer API (03-02) will return only `mux_playback_id`, never `mux_stream_key`.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `cloudflare_stream_id` (v1 schema) | `mux_stream_id` + `mux_playback_id` | Mux replaces Cloudflare Stream; column rename needed conceptually |
| Direct `rtmp://global-live.mux.com:5222/app/<key>` URL | `mux://<key>` shorthand | LiveKit handles Mux routing; simpler, preferred |
| Polling for egress active status | `listEgress({active: true})` | Built-in filter — no polling loop needed |

**Deprecated/outdated:**

- `cloudflare_stream_id` column: exists in schema, not used in Phase 3.  Leave in place; will be
  dropped or repurposed in a future migration if needed.
- `EncodingOptionsPreset` deprecated overload (`startRoomCompositeEgress(roomName, output, layout?, options?)`)
  — use `RoomCompositeOptions` object form instead (see TypeScript type in d.ts).

---

## Open Questions

1. **Mux latency mode for Phase 03-02**
   - What we know: `reduced` gives 12-20s, `low` gives ~5s with LL-HLS.
   - What's unclear: Phase 03-02 needs a "honest delay indicator."  The spec implies the delay matters
     to UX.  If reduced (12-20s) is acceptable, use it.  If the team wants sub-10s, `low` requires
     LL-HLS player support (HLS.js 1.1.5+, VideoJS 8+).
   - Recommendation: Start with `reduced` for Phase 03-01.  Phase 03-02 researcher should confirm.

2. **Where debate ends: last segment vs explicit 'complete' action**
   - What we know: The route transitions `debate.status='completed'` only on last segment end.
   - What's unclear: Is there a separate "end debate" API action, or is it implicit from the last segment?
   - Recommendation: Planner should confirm with existing `transitions.ts` logic.  The egress stop
     should fire once, on the transition to `'completed'`, wherever that happens.

3. **mux_stream_key RLS exposure**
   - What we know: `listening.debates` SELECT is granted to `authenticated` for live/completed debates.
   - What's unclear: `mux_stream_key` would be visible to any authenticated user who can read the debate
     row — that is a secret credential leak.
   - Recommendation: Either (a) store key in a server-only table or (b) exclude the column from the
     SELECT grant via a view.  Most pragmatic: null out `mux_stream_key` after egress starts (it is
     no longer needed once egress is running).

---

## Sources

### Primary (HIGH confidence)

- `node_modules/livekit-server-sdk/dist/EgressClient.d.ts` — full type signatures for `startRoomCompositeEgress`, `stopEgress`, `listEgress`, `EgressInfo`
- `node_modules/livekit-server-sdk/dist/EgressClient.js` — implementation confirms behavior
- `node_modules/@livekit/protocol/dist/index.d.ts` — `StreamOutput`, `StreamProtocol`, `EgressStatus`, `EncodingOptionsPreset` enums
- `supabase/migrations/20260420000000_create_listening_schema.sql` — debates table current columns
- `lib/env.ts` — confirmed `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` declared as optional

### Secondary (MEDIUM confidence)

- LiveKit Docs `docs.livekit.io/home/egress/outputs/` (fetched) — confirmed `mux://<stream_key>` URL shorthand, `speaker` layout
- LiveKit Docs `docs.livekit.io/home/egress/api/` (fetched) — confirmed `listEgress` with `active` filter
- Mux Docs `www.mux.com/docs/guides/start-live-streaming` (fetched) — RTMP ingest URL, response fields, `latency_mode`
- Mux API Ref `www.mux.com/docs/api-reference/video/live-streams/create-live-stream` (fetched) — response schema
- Mux API Ref `www.mux.com/docs/api-reference/video/live-streams/signal-live-stream-complete` (fetched) — `complete()` behavior
- Mux Blog `www.mux.com/blog/reconnect-windows-and-clean-stream-exits` (fetched) — reconnect_window trade-offs
- `tessl.io` mux-node-sdk 12.8.0 docs (fetched) — `liveStreams.create` params, `complete(id)`, `delete(id)` method names

### Tertiary (LOW confidence)

- WebSearch: LiveKit Egress error patterns (GitHub issues) — `TwirpError` / `deadline_exceeded` known failure modes

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — SDK files read directly from node_modules; Mux SDK interface verified via official docs
- Architecture (where to store IDs): HIGH — follows existing pattern in debates schema
- Egress API calls: HIGH — read from installed SDK source
- Mux API calls: MEDIUM — SDK not yet installed, verified via fetched docs
- `mux://` URL shorthand: MEDIUM — documented at official LiveKit docs page (fetched), consistent across two pages
- Pitfalls: MEDIUM — derived from GitHub issues + official Mux reconnect-window blog post

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable SDKs; re-verify if livekit-server-sdk or @mux/mux-node major version bumps)
