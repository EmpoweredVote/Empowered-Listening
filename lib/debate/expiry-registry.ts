import 'server-only';
import { getPool } from '@/lib/db/pool';
import { performSegmentEnd } from '@/lib/debate/end-segment-flow';
import { expiryTimestamp } from '@/lib/debate/expiry-time';

/**
 * Server-side segment expiry.
 *
 * Until now the only thing that ended an over-running segment was the
 * moderator's browser tab: `useSegmentAutoExpire` and `BonusTimeDisplay` both
 * polled client-side and POSTed `action: 'end'`. A closed laptop, a crashed
 * tab or a phone call froze the debate — nothing advanced, both speakers kept
 * their mics, and the transcript kept recording. That contradicts the rule the
 * project states plainly: timers are server-authoritative, clients render.
 *
 * This holds one `setTimeout` per active segment in module scope, the same
 * shape as `lib/transcription/registry.ts`. That works because this is a
 * long-running Node service (not a serverless function) running a single
 * instance — `numInstances: 1` on Render. **If this service is ever scaled
 * past one instance, every instance will schedule its own timer** and they
 * will all fire. `end_segment` charges the bonus pool only once under a row
 * lock, and `performSegmentEnd` is written to be safe to repeat, so the
 * outcome stays correct — but at that point this belongs in a single worker
 * or behind an advisory lock rather than in every web process.
 */
const timers = new Map<string, NodeJS.Timeout>();

interface ExpiryRow {
  end_time: string | null;
  speaker_id: string | null;
  status: string;
  paused_remaining_seconds: number | null;
  bonus_time_seconds: number;
}

/** Cancel any pending expiry for a segment. Safe to call when none exists. */
export function cancelSegmentExpiry(segmentId: string): void {
  const existing = timers.get(segmentId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(segmentId);
  }
}

/** How many timers are pending — for the health route and for tests. */
export function pendingExpiryCount(): number {
  return timers.size;
}

/**
 * Schedule (or re-schedule) the expiry of one segment.
 *
 * Expiry is `end_time` plus whatever is left of the speaker's bonus pool,
 * because a speaker whose allocated time runs out keeps talking on bonus until
 * that is gone too. A segment with no speaker (CX, moderator-run) expires at
 * `end_time` exactly.
 *
 * Does nothing for a segment that is not active, or that is paused for prep —
 * during prep `end_time` is not a live deadline.
 */
export async function scheduleSegmentExpiry(debateId: string, segmentId: string): Promise<void> {
  cancelSegmentExpiry(segmentId);

  const pool = getPool();
  const { rows } = await pool.query<ExpiryRow>(
    `SELECT s.end_time,
            s.speaker_id,
            s.status,
            s.paused_remaining_seconds,
            COALESCE(sp.bonus_time_seconds, 0) AS bonus_time_seconds
       FROM listening.debate_segments s
       LEFT JOIN listening.debate_speakers sp ON sp.id = s.speaker_id
      WHERE s.id = $1 AND s.debate_id = $2`,
    [segmentId, debateId],
  );
  if (rows.length === 0) return;

  const row = rows[0];
  if (row.status !== 'active') return;
  if (row.paused_remaining_seconds !== null) return;
  if (!row.end_time) return;

  const expiresAtMs = expiryTimestamp(
    row.end_time,
    row.bonus_time_seconds,
    row.speaker_id !== null,
  );
  if (Number.isNaN(expiresAtMs)) return;

  // A process that was down past the deadline fires immediately rather than
  // scheduling into the past.
  const delayMs = Math.max(0, expiresAtMs - Date.now());

  const timer = setTimeout(() => {
    timers.delete(segmentId);
    void expireSegment(debateId, segmentId);
  }, delayMs);

  // Do not hold the event loop open on this timer alone.
  timer.unref?.();
  timers.set(segmentId, timer);
}

/**
 * End a segment on the server's own authority.
 *
 * `end_segment` checks that the caller is the debate's moderator, so the
 * moderator's own id is resolved and used — the server is acting for them, not
 * bypassing the check.
 */
async function expireSegment(debateId: string, segmentId: string): Promise<void> {
  try {
    const pool = getPool();

    // Re-read rather than trust the state captured when the timer was set: the
    // moderator may have ended, repeated or paused the segment in the meantime.
    const { rows } = await pool.query<{ status: string; moderator_user_id: string | null }>(
      `SELECT s.status,
              (SELECT ds.user_id FROM listening.debate_speakers ds
                WHERE ds.debate_id = s.debate_id AND ds.role = 'moderator'
                LIMIT 1) AS moderator_user_id
         FROM listening.debate_segments s
        WHERE s.id = $1 AND s.debate_id = $2`,
      [segmentId, debateId],
    );
    if (rows.length === 0) return;
    if (rows[0].status !== 'active') return;

    const moderatorUserId = rows[0].moderator_user_id;
    if (!moderatorUserId) {
      console.error('[expiry] no moderator on debate %s — cannot end segment', debateId);
      return;
    }

    await performSegmentEnd({ debateId, segmentId, moderatorUserId });
    console.info('[expiry] ended segment %s of debate %s', segmentId, debateId);
  } catch (err) {
    // A failed auto-expire must not take the process down. The moderator's
    // End button is still there.
    console.error('[expiry] failed to end segment %s:', segmentId, err);
  }
}

/**
 * Re-arm timers for every segment that is still running.
 *
 * Called once at boot from `instrumentation.ts`, because a deploy or a restart
 * drops every in-memory timer and a debate mid-flight would otherwise never
 * advance again.
 *
 * The filter on `status = 'active'` keeps this off the hot path of the shared
 * instance — at most one row per live debate, never a table scan of segments
 * (ev-cto decision 0038).
 */
export async function rescheduleActiveSegments(): Promise<number> {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; debate_id: string }>(
      `SELECT s.id, s.debate_id
         FROM listening.debate_segments s
         JOIN listening.debates d ON d.id = s.debate_id
        WHERE s.status = 'active'
          AND d.status = 'live'
          AND s.paused_remaining_seconds IS NULL`,
    );

    for (const row of rows) {
      await scheduleSegmentExpiry(row.debate_id, row.id);
    }

    if (rows.length > 0) {
      console.info('[expiry] re-armed %d segment timer(s) after boot', rows.length);
    }
    return rows.length;
  } catch (err) {
    console.error('[expiry] boot re-arm failed:', err);
    return 0;
  }
}
