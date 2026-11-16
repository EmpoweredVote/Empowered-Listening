import { decodeJwt } from 'jose';

/**
 * Resolves the INTERNAL user id from a token, client-side.
 *
 * Two issuers are in play during the Supabase Auth → WorkOS AuthKit migration
 * (ev-accounts decision 0002):
 *
 *   - Supabase (legacy): `sub` IS the internal UUID.
 *   - WorkOS AuthKit:    `sub` is a WorkOS-side id (`user_01…`) and the internal
 *                        UUID travels in `external_id`.
 *
 * Every `listening` row is keyed on the internal UUID — `debate_speakers.user_id`
 * is written from `verifyToken`'s `userId` in the token route, which is already
 * issuer-aware. So a caller that reads `sub` directly matches nothing under a
 * WorkOS token, and that surfaces as MISSING DATA, not as an auth error: a
 * speaker is silently classified as an observer and never offered their own UI.
 *
 * `external_id` first, then `sub` — the same order as the Civic Spaces frontend
 * (`decodeUserId`) and the `civic_spaces.current_user_id()` SQL function, so the
 * three layers of this platform agree.
 *
 * This decode is UNVERIFIED and is for UI gating only. Every civic write is
 * re-verified server-side by `verifyToken` (lib/auth/jwks.ts), which is the only
 * thing standing between a forged token and the database.
 */
export function userIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null;

  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(token);
  } catch {
    return null;
  }

  const externalId = claims.external_id;
  if (typeof externalId === 'string' && externalId.length > 0) return externalId;

  const sub = claims.sub;
  if (typeof sub === 'string' && sub.length > 0) return sub;

  return null;
}
