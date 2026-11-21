import 'server-only';
import { getPool } from '@/lib/db/pool';
import { countParticipants } from '@/lib/livekit/room-service';
import { endDebate } from '@/lib/debate/end-debate';
import { nextEmptySince, shouldEndAbandoned, type AbandonCandidate } from './abandon-rules';

/**
 * Ends a debate that everybody has left.
 *
 * A debate stays `live` until something ends it, and until now only two things
 * did: the moderator pressing **End debate**, or the moderator driving the
 * debate to the end of segment 7, which flips the row to `completed` and tears
 * down there. Everything else — a closed laptop, a crashed tab, a walkthrough
 * abandoned two minutes in — left the row reading `live` indefinitely. On
 * 2026-11-20 one sat that way for six and a half hours.
 *
 * `sweepOrphanedEgress` does not catch this. It works from LiveKit's list of
 * active egresses, so a debate that never started one is invisible to it. It
 * guards the bill; this guards the record, and the two overlap only when an
 * abandoned debate happens to be streaming.
 *
 * Only speakers and the moderator count. All three hold LiveKit seats, so the
 * room's participant count answers "is anyone running this debate" without a
 * client heartbeat and without trusting a client for a liveness signal.
 * Observers watch Mux HLS anonymously, hold no seat, and so cannot hold a dead
 * debate open — which is the decision, not an oversight.
 *
 * **The clock is in memory.** A restart forgets how long a room has been empty
 * and the grace window starts over, so an abandoned debate can outlive a
 * redeploy by up to one extra window. That is cheap for a backstop measured in
 * minutes, and it avoids a column and a migration for state that is worthless
 * after a restart anyway. LiveKit remains the source of truth for presence;
 * only the stopwatch is ours.
 *
 * **Single instance.** This holds module-scope state, the same shape as
 * `lib/transcription/registry.ts`, and that works because this is a
 * long-running Node service running one instance (`numInstances: 1` on
 * Render). **If this service is ever scaled past one instance, every instance
 * will run its own watcher** and they will race to end the same debate. The
 * outcome stays correct — `teardownDebateMedia` is safe to call more than
 * once, and the status UPDATE in `endDebate` is guarded on
 * `status IN ('scheduled','live')`, so the second caller gets
 * `already ended` — but at that point this belongs in a single worker or
 * behind an advisory lock rather than in every web process.
 */

/** How often the watcher looks. Grace is two minutes, so this costs little. */
export const ABANDON_POLL_MS = 30_000;

/** debateId -> when its room was first seen empty. */
const emptySince = new Map<string, number>();

let timer: NodeJS.Timeout | null = null;
/** One pass at a time: a slow LiveKit call must not overlap the next tick. */
let running = false;

interface LiveDebateRow {
  id: string;
  status: AbandonCandidate['status'];
  /** Nullable in the schema, so a row can arrive with no room to ask about. */
  livekit_room_name: string | null;
  /** The debate's own seats — see `countParticipants` on why this is needed. */
  identities: string[];
}

export interface AbandonSweepResult {
  checked: number;
  /** Debates ended by this pass. */
  ended: string[];
}

/** How many debates are being timed. Exported for tests. */
export function pendingAbandonClocks(): number {
  return emptySince.size;
}

/**
 * One pass.
 *
 * Exported so tests can drive it with an explicit `nowMs` instead of waiting
 * on timers. Never rejects: a pass that threw would kill the interval, and the
 * watcher would stop silently — the same class of failure it exists to catch.
 */
export async function sweepAbandonedDebates(
  nowMs: number = Date.now(),
): Promise<AbandonSweepResult> {
  if (running) return { checked: 0, ended: [] };
  running = true;

  const result: AbandonSweepResult = { checked: 0, ended: [] };

  try {
    // Filtered to live debates, never a scan: this instance is shared and on a
    // daily Disk IO budget (CLAUDE.md). The seats come back on the same query
    // rather than one lookup per debate.
    const { rows } = await getPool().query<LiveDebateRow>(
      `SELECT d.id,
              d.status,
              d.livekit_room_name,
              COALESCE(
                array_agg(ds.livekit_identity) FILTER (WHERE ds.livekit_identity IS NOT NULL),
                '{}'
              ) AS identities
         FROM listening.debates d
         LEFT JOIN listening.debate_speakers ds ON ds.debate_id = d.id
        WHERE d.status = 'live'
        GROUP BY d.id`,
    );
    result.checked = rows.length;

    // Anything no longer live is no longer ours to time. Without this the map
    // keeps an entry per debate ever seen, in a process that runs for weeks.
    const live = new Set(rows.map(r => r.id));
    for (const id of emptySince.keys()) {
      if (!live.has(id)) emptySince.delete(id);
    }

    for (const row of rows) {
      try {
        if (!row.livekit_room_name) {
          // Nullable column. A null handed to listParticipants would read as a
          // missing room, which reads as an empty one — cancelling a debate on
          // the strength of a column that was never written.
          emptySince.delete(row.id);
          continue;
        }

        const participants = await countParticipants(
          row.livekit_room_name,
          new Set(row.identities),
        );
        const since = nextEmptySince(emptySince.get(row.id) ?? null, participants, nowMs);

        if (since === null) {
          emptySince.delete(row.id);
          continue;
        }
        emptySince.set(row.id, since);

        if (!shouldEndAbandoned({ status: row.status, participants, emptySinceMs: since, nowMs })) {
          continue;
        }

        // `cancelled`, not `completed`: a debate that ran to the end of
        // segment 7 is already `completed`, so one still reading `live` did
        // not finish. The record should say what happened.
        await endDebate(row.id, 'cancelled');
        emptySince.delete(row.id);
        result.ended.push(row.id);
        console.warn(
          `[abandon-watch] ended debate ${row.id} — room ${row.livekit_room_name} empty since ` +
          `${new Date(since).toISOString()}`,
        );
      } catch (err) {
        // One debate's failure must not abandon the rest of the pass.
        console.error(`[abandon-watch] debate ${row.id} failed:`, err);
      }
    }
  } catch (err) {
    console.error('[abandon-watch] pass failed:', err);
  } finally {
    running = false;
  }

  return result;
}

/**
 * Should this process run the watcher at all?
 *
 * Deployed: yes. A local checkout: no, unless asked.
 *
 * The hazard is not the extra polling, it is `countParticipants` mapping a
 * missing room to `0`. That reasoning holds only while you are asking the same
 * LiveKit project the debate is running in. A checkout pointed at the shared
 * database but at a different LiveKit project — or at none — sees `not_found`
 * for every room, reads every live debate as empty, and cancels a real debate
 * with people in it two minutes later. Unset credentials fail safe, because
 * `getRoomService()` throws and the count comes back `null`; *wrong* ones fail
 * destructively, and nothing from inside this process can tell the two apart.
 *
 * `ABANDON_WATCH=1` turns it on anywhere, for a staging box. `ABANDON_WATCH=0`
 * turns it off in production, as an escape hatch if it ever misbehaves during
 * a sitting.
 */
export function shouldStartAbandonWatch(
  env: { NODE_ENV?: string; ABANDON_WATCH?: string } = process.env,
): boolean {
  if (env.ABANDON_WATCH === '1') return true;
  if (env.ABANDON_WATCH === '0') return false;
  return env.NODE_ENV === 'production';
}

/** Start the watcher. Idempotent — a second call is a no-op. */
export function startAbandonWatch(): void {
  if (timer) return;
  timer = setInterval(() => {
    void sweepAbandonedDebates();
  }, ABANDON_POLL_MS);
  // Never hold the process open on account of this.
  timer.unref?.();
}

/** Stop the watcher and forget every clock. For tests and for shutdown. */
export function stopAbandonWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  emptySince.clear();
  running = false;
}
