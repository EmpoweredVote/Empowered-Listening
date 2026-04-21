import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDebate } from '@/lib/debate/create';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';

const bodySchema = z.object({
  topic: z.string().trim().min(3).max(200),
  moderatorDisplayName: z.string().trim().min(1).max(80),
  affirmativeName: z.string().trim().min(1).max(80),
  negativeName: z.string().trim().min(1).max(80),
});

export async function POST(req: NextRequest) {
  let moderatorUserId: string;
  try {
    moderatorUserId = await requireModeratorFromRequest(req);
  } catch (err) {
    if (err instanceof ModeratorGateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await createDebate({
      topic: parsed.data.topic,
      moderatorUserId,
      moderatorDisplayName: parsed.data.moderatorDisplayName,
      affirmativeName: parsed.data.affirmativeName,
      negativeName: parsed.data.negativeName,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/debates]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
