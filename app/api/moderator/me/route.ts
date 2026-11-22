import { NextRequest, NextResponse } from 'next/server';
import { requireModeratorFromRequest, ModeratorGateError } from '@/lib/auth/require-moderator';

// Required: the gate reads the role from public.user_roles through pg, whose
// native bindings do not exist on the edge runtime.
export const runtime = 'nodejs';

/**
 * Does the caller hold the listening_moderator role?
 *
 * This exists so the moderator UI can gate itself honestly.  It cannot be done
 * in `middleware.ts`: this app keeps its JWT in localStorage (`ev_token`) and
 * never in a cookie, so middleware — which sees only cookies and headers —
 * never learns who is asking.
 *
 * It is a convenience for rendering, not a security boundary.  Every moderator
 * route runs this same gate for itself, and the pages behind it already render
 * no debate data server-side.  Nothing is protected by the answer here; the UI
 * just stops showing a shell that was always going to fail.
 */
export async function GET(req: NextRequest) {
  try {
    await requireModeratorFromRequest(req);
    // Deliberately no user id.  The UI needs a yes or a no, and a gate answer
    // should not double as a way to read back an internal id.
    return NextResponse.json({ isModerator: true });
  } catch (e) {
    if (e instanceof ModeratorGateError) {
      return NextResponse.json({ isModerator: false, error: e.message }, { status: e.status });
    }
    // verifyToken itself threw — unknown issuer, unreachable JWKS, missing
    // external_id.  The gate never got as far as deciding, so this is not a
    // 403: it is "we could not establish who you are".
    console.error('[moderator/me] token verification failed:', e);
    return NextResponse.json({ isModerator: false, error: 'Auth failed' }, { status: 401 });
  }
}
