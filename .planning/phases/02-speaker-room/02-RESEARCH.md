# Phase 02: Speaker Room - Research

**Researched:** 2026-04-20
**Domain:** LiveKit WebRTC, server-authoritative timers, Supabase Realtime, React state management
**Confidence:** HIGH overall (primary sources verified via official LiveKit docs and Supabase docs)

---

## Summary

Phase 2 is the most technically dense phase of the project.  It combines four distinct domains that must work together: (1) LiveKit room setup with token minting and mic-permission enforcement, (2) a server-authoritative debate state machine with 7 LD segments, (3) synchronized countdown timers across all clients with sub-200ms variance, and (4) a React UI with three video tiles and a 4-state visual timer.  Phase 1 delivered the schema, auth, and credentials — Phase 2 builds everything on top of that foundation.

The standard LiveKit approach for mic control in a structured-speaking context is `updateParticipant` with `permission.canPublish: false/true` rather than `mutePublishedTrack`.  Revoking `canPublish` automatically unpublishes all the participant's tracks and prevents republishing — which is exactly what segment transitions require.  The `mutePublishedTrack` API only silences a specific track SID and requires a prior `getParticipant` call to find the SID; it also requires `enable_remote_unmute` to be enabled in LiveKit Cloud project settings to unmute.  For the bonus grace-time auto-mute on pool exhaustion, `updateParticipant` with `canPublish: false` is the correct call because the moderator never needs to "unmute" the speaker after the pool runs out — the mic stays off until the next segment starts a new speaker.

The server-authoritative timer pattern uses `end_time` (a future absolute timestamp stored in the database row) rather than broadcasting tick events.  Clients subscribe to `postgres_changes` on `listening.debate_segments` and independently compute `remaining = end_time - Date.now()` on each local `setInterval` tick.  This eliminates per-tick server traffic and naturally self-corrects for clock drift and late-joining clients.  The 200ms variance target is achievable with this pattern plus Supabase Realtime's WebSocket delivery.

**Primary recommendation:** Use `livekit-server-sdk` v2 (`AccessToken` + `RoomServiceClient`) for all server-side LiveKit operations, `@livekit/components-react` v2 with `useTracks` / `useParticipants` hooks for the React UI, Supabase Realtime `postgres_changes` for timer distribution, and Zustand for local client timer state.  Wrap all state-transition writes in SECURITY DEFINER RPCs because multi-table atomicity is required (segments + debates + debate_speakers all update together at segment transitions).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| livekit-server-sdk | 2.15.1 (current) | Token minting, RoomServiceClient for mic control | Official LiveKit Node.js server SDK; v2 async API |
| livekit-client | 2.18.1 (current) | Browser WebRTC client | Required peer dep; handles WebRTC connection |
| @livekit/components-react | 2.9.20 (current) | React components and hooks for video tiles | Official first-party React abstraction over livekit-client |
| @livekit/components-styles | latest | Default CSS for LiveKit components | Required peer dep alongside components-react |
| zustand | 4.x | Client-side timer and debate state store | Locked project constraint from architecture doc; selective re-renders |
| @supabase/supabase-js | 2.x | Supabase client for Realtime channel subscriptions | Already in project; used for postgres_changes subscriptions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg (node-postgres) | 8.x | Direct Postgres writes to `listening` schema | All state transitions (PostgREST does not expose `listening`) |
| zod | 4.x | Validate API request bodies (create debate, token endpoints) | All POST API routes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `updateParticipant canPublish` | `mutePublishedTrack` | mutePublishedTrack is track-specific and requires getting the track SID first; also requires `enable_remote_unmute` in Cloud settings to re-enable. `updateParticipant` cleanly revokes/grants publish ability per segment without needing a prior lookup |
| Supabase Realtime postgres_changes | LiveKit data messages | LiveKit data messages are in-room only; observers (Phase 3) would not receive timer state. Supabase Realtime is the cross-tier channel |
| Zustand | React Context | Context re-renders every consumer on any state change; timer ticks at 100ms would be expensive. Zustand allows selective subscriptions |
| `end_time` in DB (server-authoritative) | Broadcasting tick events | Tick broadcasting scales poorly and requires re-sync logic for late joiners. `end_time` in DB is idempotent and handles reconnects natively |

**Installation:**
```bash
npm install livekit-server-sdk livekit-client @livekit/components-react @livekit/components-styles zustand
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── api/
│   ├── debates/
│   │   ├── route.ts              # POST — create debate, insert rows, return join URLs
│   │   └── [debateId]/
│   │       ├── token/
│   │       │   └── route.ts      # POST — mint LiveKit JWT for a participant
│   │       └── segments/
│   │           └── [segmentId]/
│   │               └── route.ts  # POST — moderator transition (start/end/repeat segment)
├── join/
│   ├── speaker/[debateId]/
│   │   └── page.tsx              # Speaker room (desktop-only, auth-gated)
│   └── moderator/[debateId]/
│       └── page.tsx              # Moderator room (desktop-only, auth-gated)
lib/
├── livekit/
│   ├── tokens.ts                 # mintToken(identity, room, grants): Promise<string>
│   └── room-service.ts           # RoomServiceClient wrapper for mic control
├── debate/
│   ├── create.ts                 # createDebate() — DB writes + room name generation
│   ├── segments.ts               # LD segment definitions (7 segments, durations)
│   └── transitions.ts            # SECURITY DEFINER RPC callers for state transitions
store/
└── debateStore.ts                # Zustand store: timer state, segment state, prep pools
components/
├── debate/
│   ├── DebateRoom.tsx            # LiveKitRoom wrapper + Supabase channel subscription
│   ├── ParticipantGrid.tsx       # Three equal video tiles (A, B, Moderator)
│   ├── SpeakerTile.tsx           # Single tile: video + name label + mic indicator
│   ├── SegmentTimer.tsx          # 4-state countdown display
│   ├── PrepTimeDisplay.tsx       # Secondary countdown for prep pool
│   ├── BonusTimeDisplay.tsx      # Small secondary countdown alongside frozen timer
│   ├── SpeakerControls.tsx       # Prep time button for active speaker
│   └── ModeratorPanel.tsx        # Start/end/repeat segment controls
supabase/
└── migrations/
    └── 20260420000002_speaker_room_rpcs.sql  # SECURITY DEFINER RPCs + grants
```

### Pattern 1: Token Minting (Server-Side)

**What:** Generate per-participant LiveKit JWTs with role-appropriate grants.
**When to use:** Called by the `POST /api/debates/[debateId]/token` route after verifying the caller's identity against `listening.debate_speakers`.

```typescript
// Source: https://docs.livekit.io/home/server/generating-tokens/
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import { env } from '@/lib/env';

export type ParticipantRole = 'speaker' | 'moderator';

export async function mintToken(
  identity: string,    // debate_id:user_id
  roomName: string,
  role: ParticipantRole,
): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: 60 * 60 * 4, // 4 hours — covers longest LD debate with buffer
  });

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canSubscribe: true,
    canPublish: role === 'speaker',       // speakers publish mic; moderator does not
    canPublishData: true,                  // both roles can send data messages
    roomAdmin: role === 'moderator',       // moderator needs roomAdmin for updateParticipant
  };

  at.addGrant(grant);
  return at.toJwt();
}
```

**Critical:** `toJwt()` is async in v2 — always `await` it.  Omitting `await` returns a Promise, not a string, and LiveKit will reject the connection.

### Pattern 2: Server-Authoritative Timer via Database `end_time`

**What:** Store an absolute `end_time` timestamp when a segment becomes active.  Clients independently compute remaining time from `end_time - Date.now()` on a local interval.
**When to use:** All segment timers (main segment, prep time pool, bonus pool).

```typescript
// Source: Verified pattern from Supabase Realtime + timer sync research
// Server-side (API route / RPC) — when starting a segment:
const segmentDurationMs = allocatedSeconds * 1000;
const endTime = new Date(Date.now() + segmentDurationMs);

await pool.query(
  `UPDATE listening.debate_segments
   SET status = 'active', actual_start = NOW(), end_time = $1
   WHERE id = $2`,
  [endTime, segmentId],
);
// Supabase Realtime broadcasts this UPDATE to all subscribers immediately.

// Client-side (Zustand store) — after receiving the UPDATE via postgres_changes:
const computeRemaining = (endTime: Date): number =>
  Math.max(0, endTime.getTime() - Date.now());

// In the Zustand store action triggered by Realtime:
set({ endTime, timerRunning: true });

// In a React component — read remaining time on every render cycle:
const remaining = useDebateStore((s) =>
  s.endTime ? computeRemaining(s.endTime) : 0,
);
```

**Note:** `debate_segments` does not currently have an `end_time` column — Phase 2 must add it via migration.  See Open Questions.

### Pattern 3: Mic Control via `updateParticipant` at Segment Transitions

**What:** Use `RoomServiceClient.updateParticipant` to grant/revoke `canPublish` permission when segments change.
**When to use:** Called server-side whenever a segment starts or ends.

```typescript
// Source: https://docs.livekit.io/home/server/managing-participants/
import { RoomServiceClient } from 'livekit-server-sdk';
import { env } from '@/lib/env';

const roomService = new RoomServiceClient(
  env.LIVEKIT_URL,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

// Revoke a speaker's mic (called when their segment ends)
export async function revokeMic(roomName: string, identity: string): Promise<void> {
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canPublish: false,
      canSubscribe: true,
      canPublishData: true,
    },
  });
}

// Grant a speaker's mic (called when their segment starts)
export async function grantMic(roomName: string, identity: string): Promise<void> {
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });
}
```

**CX segments:** Both speakers get `canPublish: true` — questioner asks, examined answers.

### Pattern 4: Supabase Realtime postgres_changes for `listening` Schema

**What:** Subscribe to UPDATE events on `listening.debate_segments` to distribute timer state.
**When to use:** Client-side, inside the `DebateRoom` component on mount.

```typescript
// Source: https://supabase.com/docs/guides/realtime/postgres-changes
// Prerequisite (in migration): GRANT SELECT ON listening.debate_segments TO authenticated;
// Prerequisite (in migration): ALTER TABLE listening.debate_segments REPLICA IDENTITY FULL;

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const supabase = createClientComponentClient();

const channel = supabase
  .channel(`debate-${debateId}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'listening',
      table: 'debate_segments',
      filter: `debate_id=eq.${debateId}`,
    },
    (payload) => {
      const segment = payload.new;
      // Update Zustand store with new segment state + end_time
      useDebateStore.getState().applySegmentUpdate(segment);
    },
  )
  .subscribe();

// Cleanup on unmount:
return () => { supabase.removeChannel(channel); };
```

**Critical:** The `listening` schema is non-public.  Two migration changes are required before this works: (1) `GRANT SELECT ON listening.debate_segments TO authenticated;` and (2) `ALTER TABLE listening.debate_segments REPLICA IDENTITY FULL;` (needed to filter on non-PK column `debate_id`).

### Pattern 5: Debate Creation — DB Writes + LiveKit Room Name

**What:** Create the debate record, debate_speakers rows, debate_segments rows (all 7 LD segments pre-seeded), and generate the LiveKit room name in one atomic operation.
**When to use:** `POST /api/debates` called by the moderator's create form.

```typescript
// Source: architecture doc pattern (pool.query for listening schema writes)
const roomName = `ld-${debateId}`;  // deterministic, debate-scoped

await pool.query('BEGIN');
await pool.query(
  `INSERT INTO listening.debates (id, title, topic, format, pillar, scheduled_start, status, livekit_room_name, created_by)
   VALUES ($1, $2, $3, 'lincoln_douglas', 'connect', NOW(), 'scheduled', $4, $5)`,
  [debateId, title, topic, roomName, moderatorUserId],
);
// Insert debate_speakers (affirmative, negative, moderator)
// Insert 7 debate_segments with correct allocated_seconds and sequence_order
await pool.query('COMMIT');
```

### Pattern 6: Waiting Room — Participant Connection Status

**What:** Show moderator which participants have joined the LiveKit room before starting the debate.
**When to use:** Between debate creation and segment 1 start.

```typescript
// Source: https://docs.livekit.io/reference/components/react/hook/useparticipants/
import { useParticipants } from '@livekit/components-react';

function WaitingRoom({ expectedIdentities }: { expectedIdentities: string[] }) {
  const participants = useParticipants();
  const connectedIds = participants.map((p) => p.identity);

  return (
    <ul>
      {expectedIdentities.map((id) => (
        <li key={id}>
          {id}: {connectedIds.includes(id) ? 'Connected' : 'Waiting...'}
        </li>
      ))}
    </ul>
  );
}
```

### Anti-Patterns to Avoid

- **Calling `mutePublishedTrack` for segment transitions:** Requires a prior `getParticipant` call to find the track SID, and requires `enable_remote_unmute` enabled in LiveKit Cloud settings to re-grant mic.  Use `updateParticipant` with `canPublish` grant changes instead.
- **Broadcasting timer ticks from the server:** Generates per-tick server traffic for every connected client.  Store `end_time` in the DB and let clients compute remaining time independently.
- **Using `supabaseAdmin.schema('listening').from(...).insert()`:** PostgREST does not expose non-public schemas.  All writes to `listening` schema go through `pool.query()` or SECURITY DEFINER RPCs.
- **Awaiting `at.toJwt()` with no await:** v2 of livekit-server-sdk made `toJwt()` async.  Skipping `await` silently returns a Promise object, which LiveKit's connection handshake will reject.
- **Putting the Zustand timer in a React Server Component:** Zustand stores are client-only.  The `DebateRoom` must be a client component (`'use client'`).
- **Setting `SUPABASE_JWT_SECRET`:** As with Phase 1, this is prohibited.  Verification is ES256 via JWKS.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebRTC SFU media routing | Custom WebRTC signaling server | LiveKit Cloud (already provisioned in 01-02) | WebRTC SFU is hundreds of thousands of lines of code; NAT traversal, codec negotiation, SFU routing are unsolved if built custom |
| Video tile rendering | Raw `<video>` elements + MediaStream wiring | `@livekit/components-react` VideoTrack / ParticipantTile | LiveKit's components handle track subscription lifecycle, Intersection Observer optimization, and track muting events automatically |
| Timer synchronization | setInterval on the server broadcasting ticks | `end_time` timestamp in DB + Supabase Realtime UPDATE | Tick broadcasting does not handle reconnects, tab throttling, or late joiners |
| Track permission checks on client | Client-enforced mute state | LiveKit server-side `updateParticipant` | Client-enforced state can be bypassed by participants; server permission revocation is enforced at the SFU level |
| Debate state machine persistence | In-memory state on the API server | `listening.debate_segments` + `listening.debates` DB rows | Render restarts between requests; all state must be in the database |

**Key insight:** LiveKit handles all WebRTC complexity.  The application's job is to call `updateParticipant` at the right times and keep the database state authoritative.

---

## Common Pitfalls

### Pitfall 1: Non-Public Schema Realtime Not Working

**What goes wrong:** `postgres_changes` subscription to `listening.debate_segments` fires no events even though rows are updating.
**Why it happens:** Supabase Realtime's WAL listener only broadcasts changes for tables granted to the authenticated/anon roles, and only for schemas with the right publication setup.
**How to avoid:** Migration must include:
```sql
GRANT SELECT ON listening.debate_segments TO authenticated;
GRANT SELECT ON listening.debate_speakers TO authenticated;
GRANT SELECT ON listening.debates TO authenticated;
ALTER TABLE listening.debate_segments REPLICA IDENTITY FULL;
ALTER TABLE listening.debates REPLICA IDENTITY FULL;
```
Also verify the tables are added to the `supabase_realtime` publication (Supabase Cloud does this automatically for tables in the public schema; non-public schemas may need explicit `ALTER PUBLICATION supabase_realtime ADD TABLE listening.debate_segments`).
**Warning signs:** Subscription `status` callback returns `'SUBSCRIBED'` but no events fire; check Supabase Realtime logs in the dashboard.

### Pitfall 2: `toJwt()` Not Awaited

**What goes wrong:** LiveKit connection fails with an invalid token error.  The token string in the request looks like `[object Promise]`.
**Why it happens:** `livekit-server-sdk` v2 changed `toJwt()` from synchronous to async.  Code copied from pre-v2 examples omits `await`.
**How to avoid:** Always: `const token = await at.toJwt();`
**Warning signs:** `console.log(token)` prints `Promise { <pending> }` instead of a JWT string.

### Pitfall 3: Timer Clock Drift from `Date.now()` Skew

**What goes wrong:** Timer on one client shows 0:45 while another shows 0:43.  Variance exceeds 200ms target.
**Why it happens:** `Date.now()` on different clients is not synchronized.  Each client's OS clock can drift by hundreds of milliseconds.
**How to avoid:** The `end_time` pattern is self-correcting because each client independently computes `end_time - Date.now()` on every tick.  Clock drift accumulates only between Supabase Realtime delivery intervals (typically <100ms).  Do NOT compute `elapsed = Date.now() - start_time` and subtract from duration — this compounds drift over time.
**Warning signs:** Timer variance grows larger the longer the segment runs.

### Pitfall 4: `canPublish` Permissions Not Atomic with Segment Transitions

**What goes wrong:** Segment transitions in the database but the speaker's mic is still open because the `updateParticipant` call failed silently.
**Why it happens:** `updateParticipant` is a separate API call from the DB write; if one fails, the other may succeed.
**How to avoid:** In the segment transition API route: (1) update the DB first (using SECURITY DEFINER RPC for atomicity), (2) then call `updateParticipant`.  If `updateParticipant` throws, log the error and retry — LiveKit Cloud is reliable but can have transient errors.  The DB state is the source of truth; if a client reconnects, the token minting re-reads the DB and issues new grants.
**Warning signs:** Speaker is muted in the UI but the LiveKit dashboard shows their mic track still published.

### Pitfall 5: `updateParticipant` Requires `roomAdmin` Grant

**What goes wrong:** `updateParticipant` throws a 403 permission error.
**Why it happens:** Only participants with `roomAdmin: true` in their token can call the RoomServiceClient APIs that modify other participants.  Moderator tokens must include `roomAdmin: true`.
**How to avoid:** Mint moderator tokens with `roomAdmin: true` (see Pattern 1 above).  Speaker tokens must NOT have `roomAdmin: true`.
**Warning signs:** RoomServiceClient throws `{ code: 403, message: 'not authorized' }`.

### Pitfall 6: Waiting Room Shows Stale Connection Status

**What goes wrong:** Moderator's waiting room shows a speaker as "Waiting..." even though they joined.
**Why it happens:** `useParticipants()` returns only participants that have established a media connection (the `active` state, not just `signal` connection).  Participants show as connected only after their WebRTC media handshake completes.
**How to avoid:** This is expected behavior.  The waiting room should poll `useParticipants()` reactively — the hook updates automatically when new participants reach `active` state.  No custom polling needed.
**Warning signs:** Participants appear and then disappear from the list during connection setup (this is normal during the signal→active transition).

### Pitfall 7: `debate_segments.end_time` Column Missing

**What goes wrong:** Timer never starts because `end_time` is null.
**Why it happens:** The Phase 1 migration does not include an `end_time` column on `debate_segments` — that column was not in the original architecture schema definition.
**How to avoid:** Phase 2 migration must add `end_time timestamptz` to `debate_segments`.  Also add `prep_time_end_time timestamptz` for prep pool tracking.
**Warning signs:** Supabase UPDATE payload for `debate_segments` shows `end_time: null` even after segment start.

### Pitfall 8: Remote Unmute Blocked by Default

**What goes wrong:** After a segment ends and a new speaker starts, calling `updateParticipant` with `canPublish: true` on the new speaker does not enable their mic.
**Why it happens:** LiveKit Cloud has "remote unmute" disabled by default to protect user privacy.  However, this applies to `mutePublishedTrack` unmuting, NOT to `canPublish` permission grants.  Granting `canPublish: true` via `updateParticipant` does work by default — it gives the participant the *ability* to publish but does not force-enable their mic.  The client SDK then calls `localParticipant.setMicrophoneEnabled(true)` in response to the `ParticipantPermissionsChanged` event.
**How to avoid:** On the client, listen for `ParticipantPermissionsChanged` and auto-publish mic when `canPublish` becomes true for the local participant.
**Warning signs:** Participant shows as having `canPublish: true` in LiveKit dashboard but their mic track is not publishing — they need to call `setMicrophoneEnabled(true)` client-side.

---

## Code Examples

### Creating the LiveKit Room Token Endpoint (Next.js API Route)

```typescript
// app/api/debates/[debateId]/token/route.ts
// Source: https://docs.livekit.io/frontends/authentication/tokens/endpoint/
import { NextRequest, NextResponse } from 'next/server';
import { mintToken } from '@/lib/livekit/tokens';
import { verifyToken } from '@/lib/auth/jwks';
import { pool } from '@/lib/db/pool';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  // Verify caller JWT
  const jwtToken = req.headers.get('authorization')?.slice(7);
  if (!jwtToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(jwtToken);
  const userId = payload.sub as string;

  // Look up the participant's speaker record
  const { rows } = await pool.query(
    `SELECT ds.role, ds.livekit_identity, d.livekit_room_name
     FROM listening.debate_speakers ds
     JOIN listening.debates d ON d.id = ds.debate_id
     WHERE ds.debate_id = $1 AND ds.user_id = $2`,
    [debateId, userId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not a participant' }, { status: 403 });

  const { role, livekit_identity, livekit_room_name } = rows[0];
  const participantRole = role === 'moderator' ? 'moderator' : 'speaker';

  const livekitToken = await mintToken(livekit_identity, livekit_room_name, participantRole);

  return NextResponse.json({
    token: livekitToken,
    serverUrl: process.env.LIVEKIT_URL,
  });
}
```

### DebateRoom Component (React, Client-Only)

```typescript
// components/debate/DebateRoom.tsx
// Source: https://docs.livekit.io/reference/components/react/component/livekitroom/
'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { ParticipantGrid } from './ParticipantGrid';
import { useDebateSync } from '@/hooks/useDebateSync';

interface DebateRoomProps {
  token: string;
  serverUrl: string;
  debateId: string;
}

export function DebateRoom({ token, serverUrl, debateId }: DebateRoomProps) {
  useDebateSync(debateId); // subscribes to postgres_changes

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={true}
      audio={true}
      onConnected={() => { /* update local state */ }}
      onDisconnected={() => { /* show reconnecting UI */ }}
    >
      <RoomAudioRenderer />
      <ParticipantGrid />
    </LiveKitRoom>
  );
}
```

### RoomServiceClient Wrapper

```typescript
// lib/livekit/room-service.ts
// Source: https://docs.livekit.io/home/server/managing-participants/
import { RoomServiceClient } from 'livekit-server-sdk';
import { env } from '@/lib/env';

// Single shared instance — RoomServiceClient is safe to reuse across requests
export const roomService = new RoomServiceClient(
  env.LIVEKIT_URL,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

export async function setMicPermission(
  roomName: string,
  identity: string,
  canPublish: boolean,
): Promise<void> {
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    },
  });
}
```

### SECURITY DEFINER RPC for Segment Transition

```sql
-- supabase/migrations/20260420000002_speaker_room_rpcs.sql
CREATE OR REPLACE FUNCTION listening.start_segment(
  p_debate_id uuid,
  p_segment_id uuid,
  p_moderator_user_id uuid,
  p_duration_seconds integer
)
RETURNS listening.debate_segments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_segment listening.debate_segments;
  v_end_time timestamptz;
BEGIN
  -- Verify caller is the debate moderator
  IF NOT EXISTS (
    SELECT 1 FROM listening.debate_speakers
    WHERE debate_id = p_debate_id AND user_id = p_moderator_user_id AND role = 'moderator'
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the debate moderator';
  END IF;

  v_end_time := NOW() + (p_duration_seconds || ' seconds')::interval;

  -- Mark any currently active segments as completed
  UPDATE listening.debate_segments
  SET status = 'completed', actual_end = NOW()
  WHERE debate_id = p_debate_id AND status = 'active';

  -- Activate this segment with end_time
  UPDATE listening.debate_segments
  SET status = 'active', actual_start = NOW(), end_time = v_end_time
  WHERE id = p_segment_id
  RETURNING * INTO v_segment;

  -- Update debate status to live if not already
  UPDATE listening.debates
  SET status = 'live', actual_start = COALESCE(actual_start, NOW())
  WHERE id = p_debate_id;

  RETURN v_segment;
END;
$$;
```

Called via: `await supabaseAdmin.rpc('listening.start_segment', { ... })`

### Segment Timer Visual State Machine

```typescript
// Computes 4-state timer visual given remaining seconds and total segment seconds
// Source: CONTEXT.md — locked thresholds (percentage-based)

type TimerState = 'normal' | 'warning' | 'red_mode' | 'expired';

export function computeTimerState(
  remainingMs: number,
  totalMs: number,
): TimerState {
  if (remainingMs <= 0) return 'expired';
  const pct = remainingMs / totalMs;
  if (pct <= 0.10) return 'red_mode';
  if (pct <= 0.25) return 'warning';
  return 'normal';
}

// Recommended colors (Claude's Discretion — within neutral→amber→red→flash progression):
// normal:   #64748b (slate-500) — neutral, not alarming
// warning:  #f59e0b (amber-500) — caution without panic
// red_mode: #ef4444 (red-500)   — urgent
// expired:  #ef4444 with CSS animation: blink 1s step-start infinite
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `livekit-react` (deprecated package) | `@livekit/components-react` | ~2023 | Old package is archived; use components-react |
| `at.toJwt()` synchronous | `await at.toJwt()` async | livekit-server-sdk v2 | Must await or get a Promise object as the token string |
| Cloudflare Workers/Stream/R2 | Render/Mux/S3 | 2026-04-20 (Phase 1) | Deployment is on Render; LiveKit credentials point to LiveKit Cloud |
| Cloudflare Pages + `@cloudflare/next-on-pages` | Render (Node.js runtime) | Phase 1 switch | All Next.js features work; no Workers runtime restrictions |

**Deprecated/outdated:**
- `livekit-react`: archived, replaced by `@livekit/components-react`
- `@cloudflare/next-on-pages`: deprecated, but moot since project switched to Render
- Synchronous `toJwt()`: only in livekit-server-sdk v1; v2 is current

---

## Open Questions

1. **`debate_segments.end_time` column missing from Phase 1 schema**
   - What we know: Phase 1 migration (`20260420000000_create_listening_schema.sql`) does not include `end_time timestamptz` or `prep_time_end_time timestamptz` columns on `debate_segments`
   - What's unclear: Whether to add in a Phase 2 migration or amend the Phase 1 migration (Phase 1 has already been applied to production)
   - Recommendation: Add a Phase 2 migration `ALTER TABLE listening.debate_segments ADD COLUMN end_time timestamptz; ADD COLUMN prep_time_end_time timestamptz;`

2. **Supabase Realtime publication for `listening` schema tables**
   - What we know: Supabase Realtime automatically adds public schema tables to the `supabase_realtime` publication; non-public schemas may require explicit `ALTER PUBLICATION supabase_realtime ADD TABLE listening.debate_segments`
   - What's unclear: Whether Supabase Cloud auto-includes non-public schema tables in the publication when `GRANT SELECT` is given
   - Recommendation: Include explicit `ALTER PUBLICATION supabase_realtime ADD TABLE ...` in the Phase 2 migration for all tables that need postgres_changes subscriptions

3. **Client auto-publish mic on `ParticipantPermissionsChanged`**
   - What we know: `updateParticipant` grants `canPublish: true` but does not force the client to publish — the client must call `localParticipant.setMicrophoneEnabled(true)` in response
   - What's unclear: Whether `@livekit/components-react` handles this automatically when audio={true} is set on LiveKitRoom, or whether explicit event handling is needed
   - Recommendation: Explicitly handle the `ParticipantPermissionsChanged` event on the local participant; call `setMicrophoneEnabled(true)` when `canPublish` becomes true and the local participant is the active speaker per current segment state

4. **Prep time pool storage — DB column vs. in-memory**
   - What we know: `debate_speakers.bonus_time_seconds` exists (60s pool); no prep_time_seconds column exists for per-debate tracking
   - What's unclear: Architecture doc says both speakers have 4-minute prep pools — there is no `prep_time_remaining_seconds` column on `debate_speakers` in the Phase 1 migration
   - Recommendation: Phase 2 migration must add `prep_time_seconds integer DEFAULT 240` to `debate_speakers`; decrement via SECURITY DEFINER RPC when prep time is invoked

5. **`listening_moderator` role slug — how it gates debate creation**
   - What we know: `listening_moderator` role slug was registered in Phase 1 (01-02-SUMMARY.md confirms this)
   - What's unclear: The CONTEXT.md says "Moderator is an Empowered account with the `listening_moderator` role" — but the accounts API `GET /api/account/me` response includes a `roles` array that needs to be checked for `listening_moderator`; the exact response shape has not been verified
   - Recommendation: Before implementing the debate creation gate, call `GET /api/account/me` with a moderator token and inspect the response to confirm `listening_moderator` appears in a `roles` array field

---

## Sources

### Primary (HIGH confidence)
- LiveKit server SDK docs — token generation, VideoGrant, RoomServiceClient — https://docs.livekit.io/home/server/generating-tokens/ and https://docs.livekit.io/home/server/managing-participants/
- LiveKit React components docs — LiveKitRoom, ParticipantTile, useTracks, useParticipants — https://docs.livekit.io/reference/components/react/
- Supabase Realtime postgres_changes — schema subscription, GRANT, REPLICA IDENTITY FULL — https://supabase.com/docs/guides/realtime/postgres-changes
- livekit-server-sdk v2.15.1 (current as of 2026-04-18 per npm) — confirmed async toJwt()
- livekit-client v2.18.1, @livekit/components-react v2.9.20 — confirmed from search results
- Phase 1 codebase (auth patterns, db/pool, env schema, migration structure) — directly read

### Secondary (MEDIUM confidence)
- Timer sync pattern (end_time in DB + client-computed diff) — verified by multiple sources: Supabase timer sync article + general WebSocket timer sync research
- Remote unmute default-disabled + `enable_remote_unmute` requirement — confirmed via LiveKit docs and GitHub issue #2318
- `canPublish` revocation auto-unpublishes tracks — confirmed via LiveKit participant management docs

### Tertiary (LOW confidence)
- Supabase non-public schema Realtime publication (ALTER PUBLICATION step) — inferred from official docs + community discussion; should be verified empirically in migration
- Auto-publish mic behavior on `ParticipantPermissionsChanged` with `audio={true}` on LiveKitRoom — not explicitly documented; requires live testing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all library versions verified from official sources; installation confirmed
- Architecture: HIGH — patterns drawn from official LiveKit and Supabase docs; codebase foundation confirmed
- Timer pattern: HIGH — end_time approach verified by multiple sources as the standard approach
- Mic control pattern: HIGH — updateParticipant vs mutePublishedTrack distinction confirmed from official docs
- Pitfalls: HIGH for most; MEDIUM for Supabase Realtime publication pitfall (empirically unverified but documented)

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (LiveKit and Supabase docs are stable; verify versions before installing)
