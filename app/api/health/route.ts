import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Liveness, plus the commit that is actually serving.
 *
 * `commit` answers the question a post-merge check really asks. Not "is the
 * service up" — that was already answered — but "is the fix I just merged the
 * code that is running". Without it, confirming a deploy means looking up the
 * Render deploy list and matching a SHA by eye; with it, one curl.
 *
 * `RENDER_GIT_COMMIT` is set by Render itself on every deploy, documented under
 * "All runtimes" and available at build time and runtime. It is deliberately
 * NOT added to `lib/env.ts`: that schema is fail-fast and would refuse to boot
 * anywhere off Render — locally, in CI, in a container — over a value that is
 * only ever informational. Same reasoning as `WORKOS_ISSUER`.
 *
 * Three small decisions, each guarding a way this could mislead:
 *
 *   * **Read inside the handler**, not at module scope, so the value describes
 *     the running process rather than whenever this module was first imported.
 *   * **Passed through verbatim.** Render documents the variable but not
 *     whether the SHA is abbreviated, so nothing here assumes a length. Compare
 *     by prefix against `git rev-parse HEAD`.
 *   * **`null`, never `""`.** Render leaves some automatic variables empty
 *     rather than unset on service types that do not carry them, and an empty
 *     string reads as "deployed at no commit" instead of "not on Render".
 */

// A cached health response would report a stale commit while looking perfectly
// current — a wrong answer dressed as a right one, which is the exact failure
// this endpoint exists to rule out. Route handlers are uncached by default in
// Next 16 and this one is verified dynamic in production; this pins it so an
// upgrade cannot quietly change that.
export const dynamic = 'force-dynamic';

export async function GET() {
  const commit = process.env.RENDER_GIT_COMMIT?.trim();

  return NextResponse.json({
    name: 'empowered-listening',
    status: 'ok',
    time: new Date().toISOString(),
    commit: commit || null,
  });
}
