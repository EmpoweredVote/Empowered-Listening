import 'server-only';
import { verifyToken } from '@/lib/auth/jwks';
import { getPool } from '@/lib/db/pool';
import type { NextRequest } from 'next/server';

/**
 * The moderator gate.
 *
 * The role is read from the DATABASE, never from the token (ev-cto decision
 * 0041).  It used to come from `app_metadata.roles` or a top-level `roles`
 * claim, which worked only because Supabase copies
 * `auth.users.raw_app_meta_data.roles` into the tokens it issues.  WorkOS never
 * sees that column, so after the 2026-08-27 cutover every WorkOS sign-in
 * resolved to no roles at all and every moderator route 403'd — creating a
 * debate, starting and ending segments, transcription, transcript edits, share
 * links.  The grant had in fact never existed in `public.user_roles`; it only
 * ever lived in the Supabase auth metadata.
 *
 * Reading `public.user_roles` makes the answer the same for both issuers and
 * makes a revocation take effect immediately rather than whenever the holder's
 * token happens to expire.
 */

export const LISTENING_MODERATOR_SLUG = 'listening_moderator';

export class ModeratorGateError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'ModeratorGateError';
  }
}

interface RoleRow {
  slug?: unknown;
}

/**
 * Does this user hold the listening_moderator role right now?
 *
 * Prefers `public.get_user_roles(uuid)`, which is ev-accounts' own accessor and
 * the thing to keep in step with. It is SECURITY DEFINER, owned by `postgres`,
 * returns a jsonb array of role rows (or `[]`), and already filters
 * `revoked_at IS NULL`.
 *
 * Falls back to reading `public.user_roles` directly if that function is
 * missing or answers in a shape we do not recognise — a schema change on the
 * accounts side should not silently lock every moderator out of a live debate.
 * The fallback deliberately mirrors the function rather than improving on it:
 * same `revoked_at IS NULL` filter, and no `roles.is_active` check, so the two
 * paths cannot disagree about who is a moderator.
 */
async function hasModeratorRole(userId: string): Promise<boolean> {
  const pool = getPool();

  try {
    const { rows } = await pool.query<{ roles: unknown }>(
      `SELECT public.get_user_roles($1::uuid) AS roles`,
      [userId],
    );
    const roles = rows[0]?.roles;
    if (Array.isArray(roles)) {
      return roles.some(
        (r): boolean =>
          typeof r === 'object' && r !== null && (r as RoleRow).slug === LISTENING_MODERATOR_SLUG,
      );
    }
    // Reachable only if get_user_roles stops returning a jsonb array.
    console.warn('[auth] get_user_roles returned an unexpected shape; using the direct query');
  } catch (err) {
    console.warn('[auth] get_user_roles unavailable; using the direct query:', err);
  }

  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1::uuid
          AND r.slug = $2
          AND ur.revoked_at IS NULL
     ) AS ok`,
    [userId, LISTENING_MODERATOR_SLUG],
  );
  return rows[0]?.ok === true;
}

/**
 * Verify the token, then check the role in the database.
 *
 * Returns the INTERNAL user id that `verifyToken` resolved — `external_id` for
 * a WorkOS token, `sub` for a Supabase one. Never the raw `sub` of a WorkOS
 * token, which is a WorkOS-side id and matches no row here (CLAUDE.md).
 */
export async function requireModerator(token: string): Promise<string> {
  if (!token) throw new ModeratorGateError(401, 'Missing token');

  // Throws on an invalid token. Not a ModeratorGateError, so callers answer 401
  // and log the reason — see app/api/debates/route.ts.
  const { userId } = await verifyToken(token);

  if (!(await hasModeratorRole(userId))) {
    throw new ModeratorGateError(403, 'Missing listening_moderator role');
  }
  return userId;
}

export async function requireModeratorFromRequest(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new ModeratorGateError(401, 'Missing Authorization header');
  return requireModerator(token);
}
