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

/** How long to wait before retrying an expiry that failed on something transient. */
export const EXPIRY_RETRY_MS = 15_000;

/** Total attempts at one segment's expiry, the first one included. */
export const EXPIRY_MAX_ATTEMPTS = 4;

/** segmentId -> attempts made so far. Only present while a retry is pending. */
const retryAttempts = new Map<string, number>();

/**
 * Should this process arm expiry timers at all?
 *
 * Deployed: yes. A local checkout: no, unless asked.
 *
 * The same reasoning as `shouldStartAbandonWatch`, and the hazard is sharper
 * here. That one fails safe without LiveKit credentials, because it cannot
 * read presence without them. This needs nothing but the database — which a
 * local checkout pointed at the shared instance has. A `next dev` process, or
 * two instances overlapping during a rolling deploy, would arm their own
 * timers against live segments and end them on their own authority, and no
 * `repeat` or prep cancel issued anywhere else can reach a timer that lives in
 * another process's memory.
 *
 * `SEGMENT_EXPIRY=1` turns it on anywhere, for a staging box. `SEGMENT_EXPIRY=0`
 * turns it off in production, as an escape hatch during a sitting. Separate
 * from `ABANDON_WATCH` on purpose: the two end different things, and stopping
 * one is not a reason to stop the other.
 */
export function shouldRunSegmentExpiry(
  env: { NODE_ENV?: string; SEGMENT_EXPIRY?: string } = process.env,
): boolean {
  if (env.SEGMENT_EXPIRY === '1') return true;
  if (env.SEGMENT_EXPIRY === '0') return false;
  return env.NODE_ENV === 'production';
}

/** Cancel any pending expiry for a segment. Safe to call when none exists. */
export function cancelSegmentExpiry(segmentId: string): void {
  const existing = timers.get(segmentId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(segmentId);
  }
  retryAttempts.delete(segmentId);
}

/** How many timers are pending — for tests. */
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
  // Also clears the retry count: re-arming is what the moderator doing
  // something — start, repeat, the end of prep — amounts to, and that is a
  // fresh deadline rather than a continuation of a failing one.
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

  // Cancelled again, immediately before arming. The cancel at the top of this
  // function is not enough on its own: the database read above is an await, so
  // two concurrent calls can both pass that first cancel, both arm, and the
  // second's `timers.set` then overwrites the first — leaving a live timer
  // nothing can reach, because every cancel path works through this map. The
  // orphan fires on a deadline the moderator has already replaced and ends the
  // segment early. Cancel and arm have to sit in one synchronous block.
  cancelSegmentExpiry(segmentId);
  armTimer(debateId, segmentId, delayMs);
}

/** Arm the one timer a segment is allowed. Callers cancel immediately before. */
function armTimer(debateId: string, segmentId: string, delayMs: number): void {
  const timer = setTimeout(() => {
    timers.delete(segmentId);
    void expireSegment(debateId, segmentId);
  }, delayMs);

  // Do not hold the event loop open on this timer alone.
  timer.unref?.();
  timers.set(segmentId, timer);
}

/**
 * Try again after an expiry that failed on something transient.
 *
 * The timer removes itself from the map before `expireSegment` runs, so
 * without this a single failed LiveKit or database call dropped the segment's
 * deadline for good and put the debate back on the moderator's tab — the
 * dependency this module exists to remove, reintroduced silently, at the one
 * moment something had already gone wrong.
 *
 * Bounded: a segment whose end keeps failing will not be fixed by a sixth
 * attempt, and a timer that re-arms for ever outlives the debate.
 */
function scheduleExpiryRetry(debateId: string, segmentId: string): void {
  const attempts = (retryAttempts.get(segmentId) ?? 0) + 1;

  if (attempts >= EXPIRY_MAX_ATTEMPTS) {
    retryAttempts.delete(segmentId);
    console.error(
      `[expiry] giving up on segment ${segmentId} of debate ${debateId} after ` +
      `${EXPIRY_MAX_ATTEMPTS} attempts — it now has no server-side deadline and ` +
      `only the moderator's End button will close it`,
    );
    return;
  }

  cancelSegmentExpiry(segmentId);
  retryAttempts.set(segmentId, attempts);
  armTimer(debateId, segmentId, EXPIRY_RETRY_MS);
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
    // The next three are outcomes, not failures: the segment is gone, the
    // moderator got there first, or there is nobody whose authority we could
    // end it on. A retry would help with none of them, so the retry count
    // goes with the deadline.
    if (rows.length === 0) {
      retryAttempts.delete(segmentId);
      return;
    }
    if (rows[0].status !== 'active') {
      retryAttempts.delete(segmentId);
      return;
    }

    const moderatorUserId = rows[0].moderator_user_id;
    if (!moderatorUserId) {
      retryAttempts.delete(segmentId);
      console.error('[expiry] no moderator on debate %s — cannot end segment', debateId);
      return;
    }

    await performSegmentEnd({ debateId, segmentId, moderatorUserId });
    retryAttempts.delete(segmentId);
    console.info('[expiry] ended segment %s of debate %s', segmentId, debateId);
  } catch (err) {
    // A failed auto-expire must not take the process down. But it must not
    // silently drop the deadline either: the timer has already removed itself,
    // so without a retry the segment is back to depending on the moderator's
    // tab, at the exact moment something is already wrong.
    console.error('[expiry] failed to end segment %s:', segmentId, err);
    scheduleExpiryRetry(debateId, segmentId);
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
