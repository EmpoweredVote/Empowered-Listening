import 'server-only';
import { pool } from '@/lib/db/pool';
import { activeWorkers } from '@/lib/transcription/registry';
import {
  debateIdFromRoomName,
  shouldStopEgress,
  type DebateLifecycle,
} from './teardown-rules';

export interface TeardownResult {
  egressStopped: boolean;
  muxCompleted: boolean;
  workerStopped: boolean;
  /** Non-fatal failures. Teardown always runs every step it can. */
  errors: string[];
}

/**
 * Release every external resource a debate holds: the LiveKit egress, the Mux
 * live stream, and the Deepgram transcription worker.
 *
 * Safe to call more than once, and on a debate that never streamed.
 *
 * Each step is attempted independently — a failure to stop the egress must not
 * leave the Mux stream open as well, which is what a single try/catch around
 * all three would do.
 */
export async function teardownDebateMedia(debateId: string): Promise<TeardownResult> {
  const errors: string[] = [];
  let egressStopped = false;
  let muxCompleted = false;
  let workerStopped = false;

  const { rows } = await pool.query<{
    livekit_egress_id: string | null;
    mux_stream_id: string | null;
  }>(
    `SELECT livekit_egress_id, mux_stream_id FROM listening.debates WHERE id = $1`,
    [debateId],
  );
  if (rows.length === 0) {
    return { egressStopped, muxCompleted, workerStopped, errors: ['Debate not found'] };
  }
  const { livekit_egress_id: egressId, mux_stream_id: muxStreamId } = rows[0];

  if (egressId) {
    try {
      const { stopDebateEgress } = await import('@/lib/livekit/egress-service');
      await stopDebateEgress(egressId);
      egressStopped = true;
    } catch (err) {
      errors.push(`egress stop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (muxStreamId) {
    try {
      const { completeMuxLiveStream } = await import('@/lib/mux/client');
      await completeMuxLiveStream(muxStreamId);
      muxCompleted = true;
    } catch (err) {
      errors.push(`mux complete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove from the registry first: a failing stop() must not leave a dead
  // worker registered, or the debate can never bootstrap a new one.
  const worker = activeWorkers.get(debateId);
  if (worker) {
    activeWorkers.delete(debateId);
    try {
      await worker.stop();
      workerStopped = true;
    } catch (err) {
      errors.push(`worker stop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Cleared even when the stop call failed. A stale id is worse than none:
  // the sweep finds orphans from LiveKit's own list, not from this column, so
  // nothing is lost by forgetting it — whereas keeping it makes a retried
  // teardown fail forever against an egress that has already ended.
  //
  // mux_stream_id is deliberately kept: it is how a completed debate's
  // recording is found later (lib/debates/recording.ts).
  await pool.query(
    `UPDATE listening.debates SET livekit_egress_id = NULL WHERE id = $1`,
    [debateId],
  );

  if (errors.length > 0) {
    console.error('[teardown] debate', debateId, 'finished with errors:', errors);
  }

  return { egressStopped, muxCompleted, workerStopped, errors };
}

export interface SweepResult {
  inspected: number;
  /** Egress ids that were stopped. */
  stopped: string[];
  /** Active egresses left alone — live debates, young ones, and rooms not ours. */
  skipped: number;
  errors: string[];
}

/**
 * Stop every active egress that no live debate justifies.
 *
 * This is the backstop for the failure that actually happened: an egress ran
 * for over six hours against an abandoned debate because the only code path
 * that stops one requires the moderator to drive the debate to its final
 * segment. Any other ending — a closed tab, an error, a deleted row — left it
 * running and billing.
 */
export async function sweepOrphanedEgress(): Promise<SweepResult> {
  const { listActiveEgress, stopDebateEgress } = await import('@/lib/livekit/egress-service');

  const active = await listActiveEgress();
  const result: SweepResult = { inspected: active.length, stopped: [], skipped: 0, errors: [] };
  if (active.length === 0) return result;

  const candidates = active.map(e => ({ ...e, debateId: debateIdFromRoomName(e.roomName) }));
  const debateIds = [...new Set(candidates.map(c => c.debateId).filter((id): id is string => id !== null))];

  // One lookup for the whole batch, filtered to the ids in hand — never an
  // unfiltered scan of listening.debates (see CLAUDE.md on this instance).
  const statuses = new Map<string, DebateLifecycle>();
  if (debateIds.length > 0) {
    const { rows } = await pool.query<{ id: string; status: DebateLifecycle }>(
      `SELECT id, status FROM listening.debates WHERE id = ANY($1::uuid[])`,
      [debateIds],
    );
    for (const row of rows) statuses.set(row.id, row.status);
  }

  for (const candidate of candidates) {
    // A room we did not mint belongs to something else in this LiveKit
    // project. Never ours to stop.
    if (!candidate.debateId) {
      result.skipped++;
      continue;
    }

    const status = statuses.get(candidate.debateId) ?? null;
    if (!shouldStopEgress({ status, ageMs: candidate.ageMs })) {
      result.skipped++;
      continue;
    }

    try {
      if (status === null) {
        // The debate row is gone, so there is nothing left to tear down but
        // the egress itself.
        await stopDebateEgress(candidate.egressId);
      } else {
        await teardownDebateMedia(candidate.debateId);
      }
      result.stopped.push(candidate.egressId);
      console.warn(
        `[teardown] swept orphaned egress ${candidate.egressId} (room=${candidate.roomName}, ` +
        `debate status=${status ?? 'deleted'}, age=${Math.round(candidate.ageMs / 60_000)}m)`,
      );
    } catch (err) {
      result.errors.push(
        `${candidate.egressId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
