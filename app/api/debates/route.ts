import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDebate } from '@/lib/debate/create';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';

// Required: this route reaches pg — directly and now also through the
// moderator gate, which reads the role from public.user_roles. Without it the
// route can be built for the edge runtime, where pg's native bindings fail.
export const runtime = 'nodejs';


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
    // Everything that is NOT a ModeratorGateError comes out of verifyToken, and
    // every one of those used to arrive here as a bare "Auth failed" with
    // nothing written to the log: unknown issuer, a WorkOS token with no
    // external_id or role=authenticated, an unreachable JWKS endpoint, an
    // expired signature.  That left a moderator staring at three words with no
    // way to tell a missing env var from a bad token.  WORKOS_ISSUER and
    // WORKOS_JWKS_URL are deliberately outside the fail-fast env schema, so a
    // typo in either surfaces exactly here and nowhere else.
    console.error('[debates] token verification failed:', err);
    return NextResponse.json(
      { error: 'Auth failed', reason: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
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
