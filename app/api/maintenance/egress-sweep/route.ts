import { NextRequest, NextResponse } from 'next/server';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { sweepOrphanedEgress } from '@/lib/debate/teardown';

// Required: reaches pg through the moderator gate and loads the LiveKit SDK.
export const runtime = 'nodejs';

/**
 * Stop every active LiveKit egress that no live debate justifies.
 *
 * The same sweep runs opportunistically whenever a segment starts, so in
 * normal use nothing needs to call this. It exists for the case that is not
 * normal use: orphans piling up during a stretch with no debates, which is
 * precisely when nobody is watching the bill.
 *
 * Moderator-gated rather than open, because it stops live infrastructure.
 * A Render cron could call it on a schedule, but Render schedules are declared
 * in ev-infra's render.yaml, not in this repo — that would be a separate PR there.
 */
export async function POST(req: NextRequest) {
  try {
    await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[egress-sweep] token verification failed:', e);
    return NextResponse.json(
      { error: 'Auth failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 401 },
    );
  }

  try {
    const result = await sweepOrphanedEgress();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[egress-sweep] failed:', err);
    return NextResponse.json(
      { error: 'Sweep failed', reason: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
