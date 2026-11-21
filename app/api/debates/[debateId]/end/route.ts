import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';
import { endDebate } from '@/lib/debate/end-debate';

// Required: reaches pg directly and through the moderator gate.
export const runtime = 'nodejs';

const bodySchema = z.object({
  /**
   * 'completed' is a debate that ran. 'cancelled' is one abandoned — a test
   * that will not be finished, or a sitting called off. Both release media;
   * the distinction is what the record says happened.
   */
  outcome: z.enum(['completed', 'cancelled']).default('completed'),
});

/**
 * End a debate and release everything it holds.
 *
 * The sequence itself lives in `lib/debate/end-debate.ts`, shared with
 * `lib/debate/abandon-watch.ts`, so the moderator pressing the button and the
 * server noticing an empty room end a debate the same way. What stays here is
 * what is specific to being an HTTP route: the moderator gate, the body
 * schema, and the status codes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ debateId: string }> },
) {
  const { debateId } = await params;

  try {
    await requireModeratorFromRequest(req);
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[end] token verification failed:', e);
    return NextResponse.json(
      { error: 'Auth failed', reason: e instanceof Error ? e.message : String(e) },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const result = await endDebate(debateId, parsed.data.outcome);
  if (result === null) {
    return NextResponse.json({ error: 'Debate not found' }, { status: 404 });
  }

  return NextResponse.json(result);
}
