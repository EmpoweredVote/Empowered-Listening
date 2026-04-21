import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyToken } from '@/lib/auth/jwks';
import { getPool } from '@/lib/db/pool';
import { startPrepTime, endPrepTime } from '@/lib/debate/transitions';
import { LD_PREP_TIME_SECONDS } from '@/lib/debate/segments';

const bodySchema = z.object({
  action: z.enum(['start', 'end']),
  speakerId: z.string().uuid(),
  prepSecondsRequested: z.number().int().min(5).max(LD_PREP_TIME_SECONDS).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
  if (!bearer) return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  let callerUserId: string;
  try { callerUserId = (await verifyToken(bearer)).sub as string; }
  catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }); }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const { action, speakerId, prepSecondsRequested } = parsed.data;

  const pool = getPool();
  const { rows: segRows } = await pool.query<{ id: string }>(
    `SELECT id FROM listening.debate_segments WHERE debate_id = $1 AND status IN ('active','paused') ORDER BY sequence_order LIMIT 1`,
    [debateId],
  );
  if (segRows.length === 0) return NextResponse.json({ error: 'No active segment' }, { status: 409 });
  const segmentId = segRows[0].id;

  try {
    if (action === 'start') {
      const result = await startPrepTime({
        debateId, segmentId, speakerId, callerUserId,
        prepSeconds: prepSecondsRequested ?? LD_PREP_TIME_SECONDS,
      });
      return NextResponse.json(result);
    }
    const segment = await endPrepTime({ debateId, segmentId, speakerId, callerUserId });
    return NextResponse.json({ segment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
