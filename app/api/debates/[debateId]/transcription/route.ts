// IMPORTANT: Must use Node.js runtime — @livekit/rtc-node uses native bindings
// that fail on Edge runtime.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { getPool } from '@/lib/db/pool';
import { activeWorkers } from '@/lib/transcription/registry';
import { TranscriptionWorker } from '@/lib/transcription/worker';

const bodySchema = z.object({
  action: z.enum(['start', 'stop']),
});

/** GET /api/debates/:debateId/transcription — returns worker status */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;
  return NextResponse.json({ active: activeWorkers.has(debateId) });
}

/** POST /api/debates/:debateId/transcription — start or stop the transcription worker */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  // Auth: moderator only
  try {
    await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { action } = parsed.data;

  const pool = getPool();

  if (action === 'start') {
    // Idempotency: return 409 if already active
    if (activeWorkers.has(debateId)) {
      return NextResponse.json({ error: 'Transcription worker already active' }, { status: 409 });
    }

    // Fetch debate status and room name
    const { rows } = await pool.query<{
      status: string;
      livekit_room_name: string;
    }>(
      `SELECT status, livekit_room_name FROM listening.debates WHERE id = $1`,
      [debateId],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
    }

    const debate = rows[0];
    if (debate.status !== 'live') {
      return NextResponse.json(
        { error: `Debate is not live (status: ${debate.status})` },
        { status: 409 },
      );
    }

    const worker = new TranscriptionWorker(debateId, debate.livekit_room_name);
    activeWorkers.set(debateId, worker);

    worker.start().catch(err => {
      console.error('[transcription] worker start failed:', err);
      activeWorkers.delete(debateId);
    });

    return NextResponse.json({ active: true });
  }

  if (action === 'stop') {
    const worker = activeWorkers.get(debateId);
    if (worker) {
      worker.stop().catch(err => console.error('[transcription] worker stop failed:', err));
      activeWorkers.delete(debateId);
    }
    // Idempotent: OK even if not active
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
