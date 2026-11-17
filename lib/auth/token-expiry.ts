import { decodeJwt } from 'jose';

/**
 * When to renew the session token, so it does not die mid-debate.
 *
 * WorkOS AuthKit access tokens are short-lived — minutes, not hours. The
 * session layer stored one in localStorage on sign-in and never looked at it
 * again: `tryRenewSession()` was called only when there was NO token, so an
 * expired one was indistinguishable from a good one and simply kept failing.
 *
 * That made the app unusable for its own core activity. A Lincoln-Douglas
 * debate runs 32 speaking minutes plus prep; the moderator's token died several
 * times over before the first segment ended, and every failure surfaced as an
 * auth error that looked like a permissions problem rather than an expiry.
 *
 * This is unverified decoding, for scheduling only — `exp` is advisory here and
 * the server re-verifies every request for real (lib/auth/jwks.ts).
 */

/** Renew this long before `exp`, so a request in flight cannot straddle it. */
export const REFRESH_SKEW_MS = 60_000;

/**
 * Never schedule a renewal closer together than this. A token whose whole life
 * is shorter than the skew would otherwise schedule at zero, and a failing
 * renewal would spin.
 */
export const MIN_REFRESH_DELAY_MS = 5_000;

/** `exp` as epoch milliseconds, or null if the token has no usable one. */
export function tokenExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  try {
    const { exp } = decodeJwt(token);
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

/**
 * Is this token past its usable life already?
 *
 * A token inside the skew window counts as expired: it may well die between the
 * check and the request that uses it, and renewing early is free.
 *
 * A token we cannot read is NOT treated as expired — it may be an issuer whose
 * shape we do not know, and the server is the authority on whether it is good.
 */
export function isTokenExpired(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  skewMs: number = REFRESH_SKEW_MS,
): boolean {
  const expiryMs = tokenExpiryMs(token);
  if (expiryMs === null) return false;
  return expiryMs - skewMs <= nowMs;
}

/** How long to wait before renewing a token that expires at `expiryMs`. */
export function refreshDelayMs(
  expiryMs: number,
  nowMs: number = Date.now(),
  skewMs: number = REFRESH_SKEW_MS,
): number {
  return Math.max(MIN_REFRESH_DELAY_MS, expiryMs - skewMs - nowMs);
}
