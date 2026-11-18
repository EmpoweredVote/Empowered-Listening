import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { startSegment, endSegment, repeatSegment } from '@/lib/debate/transitions';
import { applySegmentMicPermissions } from '@/lib/debate/mic-control';
import { getPool } from '@/lib/db/pool';
import { activeWorkers } from '@/lib/transcription/registry';
import { TranscriptionWorker } from '@/lib/transcription/worker';
import { teardownDebateMedia, sweepOrphanedEgress } from '@/lib/debate/teardown';

// Required: this route reaches pg — directly and now also through the
// moderator gate, which reads the role from public.user_roles. Without it the
// route can be built for the edge runtime, where pg's native bindings fail.
export const runtime = 'nodejs';


const bodySchema = z.object({
  action: z.enum(['start', 'end', 'repeat']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string; segmentId: string }> },
) {
  const { debateId, segmentId } = await params;

  let moderatorUserId: string;
  try {
    moderatorUserId = await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) return NextResponse.json({ error: e.message }, { status: e.status });
    // Not a ModeratorGateError means verifyToken itself threw — unknown
    // issuer, unreachable JWKS, missing external_id. Surfaced rather than
    // swallowed; see app/api/debates/route.ts for why.
    console.error('[segments] token verification failed:', e);
    return NextResponse.json(
      { error: 'Auth failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { action } = parsed.data;

  // Resolve allocated_seconds for the segment — needed for start / repeat
  const pool = getPool();
  const { rows } = await pool.query<{ allocated_seconds: number }>(
    `SELECT allocated_seconds FROM listening.debate_segments WHERE id = $1 AND debate_id = $2`,
    [segmentId, debateId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  const durationSeconds = rows[0].allocated_seconds;

  try {
    if (action === 'start') {
      // Pre-transition debate to 'live' in its own transaction BEFORE startSegment.
      // Supabase Realtime evaluates the debate_segments RLS by querying debates.status.
      // When both happen in the same transaction, Realtime may see the pre-transaction
      // value ('scheduled') and block the event.  Committing this first ensures the
      // Realtime worker sees status='live' when it evaluates the segment change.
      await pool.query(
        `UPDATE listening.debates
         SET status = 'live', actual_start = COALESCE(actual_start, NOW())
         WHERE id = $1 AND status = 'scheduled'`,
        [debateId],
      );
      const segment = await startSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
      await applySegmentMicPermissions(debateId, segmentId);

      // ---- Phase 03-01: bootstrap Mux + LiveKit egress on first-segment start ----
      const { rows: debateRows } = await pool.query<{
        livekit_room_name: string;
        livekit_egress_id: string | null;
      }>(
        `SELECT livekit_room_name, livekit_egress_id FROM listening.debates WHERE id = $1`,
        [debateId],
      );
      const debateRow = debateRows[0];

      if (debateRow && !debateRow.livekit_egress_id) {
        // Tracked outside the try so the catch can release a Mux stream that
        // was created before egress failed.
        let createdMuxStreamId: string | null = null;
        try {
          const { createMuxLiveStream } = await import('@/lib/mux/client');
          const { startDebateEgress } = await import('@/lib/livekit/egress-service');

          const { muxStreamId, muxStreamKey, muxPlaybackId } = await createMuxLiveStream();
          createdMuxStreamId = muxStreamId;

          await pool.query(
            `UPDATE listening.debates
             SET mux_stream_id = $1, mux_stream_key = $2, mux_playback_id = $3
             WHERE id = $4`,
            [muxStreamId, muxStreamKey, muxPlaybackId, debateId],
          );

          const egressId = await startDebateEgress(debateRow.livekit_room_name, muxStreamKey);

          await pool.query(
            `UPDATE listening.debates
             SET livekit_egress_id = $1, mux_stream_key = NULL
             WHERE id = $2`,
            [egressId, debateId],
          );
        } catch (egressErr) {
          // Video is not going to happen for this debate — most likely the
          // LiveKit transcode allowance is spent, which blocks egress while
          // leaving rooms, audio and transcription working normally.
          //
          // The debate still runs. What must not happen is observers being
          // handed a player pointed at a Mux stream nothing will ever push
          // to: that shows a dead video frame instead of the transcript-only
          // placeholder the page already knows how to render. So the playback
          // id is cleared, and the Mux stream released rather than orphaned.
          console.error('[egress] bootstrap failed — debate continues without video:', egressErr);

          if (createdMuxStreamId) {
            try {
              const { completeMuxLiveStream } = await import('@/lib/mux/client');
              await completeMuxLiveStream(createdMuxStreamId);
            } catch (cleanupErr) {
              console.error('[egress] releasing the unused Mux stream failed:', cleanupErr);
            }
          }

          try {
            await pool.query(
              `UPDATE listening.debates
               SET mux_stream_id = NULL, mux_stream_key = NULL, mux_playback_id = NULL
               WHERE id = $1 AND livekit_egress_id IS NULL`,
              [debateId],
            );
          } catch (clearErr) {
            console.error('[egress] clearing the dead playback id failed:', clearErr);
          }
        }
      }

      // Opportunistic sweep: every debate that starts cleans up after the last
      // one. Not awaited — a sweep failure must never stop a segment starting,
      // and the moderator should not wait on LiveKit's API to begin speaking.
      //
      // This bounds the damage without needing a cron (Render schedules live
      // in ev-infra, not this repo). It is a backstop, not the fix: the fix is
      // that every ending now calls teardownDebateMedia.
      void sweepOrphanedEgress().catch(err =>
        console.error('[teardown] opportunistic sweep failed:', err),
      );

      // ---- Phase 04-02: bootstrap transcription worker on first-segment start ----
      if (!activeWorkers.has(debateId)) {
        try {
          const worker = new TranscriptionWorker(debateId, debateRow.livekit_room_name);
          activeWorkers.set(debateId, worker);
          worker.start().catch(err => {
            console.error('[transcription] worker start failed:', err);
            activeWorkers.delete(debateId);
          });
        } catch (workerErr) {
          console.error('[transcription] worker bootstrap failed:', workerErr);
        }
      }

      return NextResponse.json({ segment });
    }

    if (action === 'end') {
      const segment = await endSegment({ debateId, segmentId, moderatorUserId });

      // ---- Phase 03-01: shut down egress + finalize Mux on last-segment end ----
      const { rows: statusRows } = await pool.query<{ status: string }>(
        `SELECT status FROM listening.debates WHERE id = $1`,
        [debateId],
      );

      if (statusRows[0]?.status === 'completed') {
        // One teardown path, shared with POST /end and the orphan sweep, so
        // egress, Mux and the transcription worker can only be released one
        // way. This used to be inlined here, which is why every other way a
        // debate could end leaked all three.
        await teardownDebateMedia(debateId);
      }

      // After end, no segment is active — mute both speakers (between-segment state).
      // applySegmentMicPermissions reads the segment_type that was just ended, which would
      // re-grant mics.  Between-segment muting is handled by a separate call path: revoke both.
      // Here we inline the revoke to keep the route self-contained.
      const { rows: speakerRows } = await pool.query<{ role: string; livekit_identity: string }>(
        `SELECT role, livekit_identity FROM listening.debate_speakers WHERE debate_id = $1 AND role IN ('affirmative','negative')`,
        [debateId],
      );
      const { rows: debateRows } = await pool.query<{ livekit_room_name: string }>(
        `SELECT livekit_room_name FROM listening.debates WHERE id = $1`, [debateId]);
      if (debateRows.length > 0) {
        const { setMicPermission } = await import('@/lib/livekit/room-service');
        await Promise.allSettled(
          speakerRows.map(s => setMicPermission(debateRows[0].livekit_room_name, s.livekit_identity, false)),
        );
      }
      return NextResponse.json({ segment });
    }

    // 'repeat' — full reset of the segment timer + clear bonus used; re-apply mic permissions
    const segment = await repeatSegment({ debateId, segmentId, moderatorUserId, durationSeconds });
    await applySegmentMicPermissions(debateId, segmentId);
    return NextResponse.json({ segment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // RPC RAISE EXCEPTION text bubbles up here — surface to the moderator UI
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
