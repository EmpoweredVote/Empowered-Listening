import { describe, it, expect } from 'vitest';
import {
  tokenExpiryMs,
  isTokenExpired,
  refreshDelayMs,
  REFRESH_SKEW_MS,
  MIN_REFRESH_DELAY_MS,
} from './token-expiry';

/** A structurally valid JWT with the given payload. Signature is never checked here. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const NOW = 1_800_000_000_000; // fixed clock, ms

describe('tokenExpiryMs', () => {
  it('reads exp and converts seconds to milliseconds', () => {
    expect(tokenExpiryMs(jwt({ exp: 1_800_000_300 }))).toBe(1_800_000_300_000);
  });

  it('returns null for a token with no exp', () => {
    expect(tokenExpiryMs(jwt({ sub: 'x' }))).toBeNull();
  });

  it('returns null for a non-numeric exp', () => {
    expect(tokenExpiryMs(jwt({ exp: 'soon' }))).toBeNull();
  });

  it('returns null rather than throwing on a malformed token', () => {
    expect(tokenExpiryMs('not-a-jwt')).toBeNull();
    expect(tokenExpiryMs('')).toBeNull();
    expect(tokenExpiryMs(null)).toBeNull();
    expect(tokenExpiryMs(undefined)).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('is false for a token with plenty of life left', () => {
    const token = jwt({ exp: (NOW + 10 * 60_000) / 1000 });
    expect(isTokenExpired(token, NOW)).toBe(false);
  });

  it('is true for a token already past exp', () => {
    const token = jwt({ exp: (NOW - 1_000) / 1000 });
    expect(isTokenExpired(token, NOW)).toBe(true);
  });

  it('is true inside the skew window, before exp has actually passed', () => {
    // 30s of life left, skew is 60s — renew now rather than risk a request
    // straddling the boundary.
    const token = jwt({ exp: (NOW + 30_000) / 1000 });
    expect(isTokenExpired(token, NOW)).toBe(true);
  });

  it('is false just outside the skew window', () => {
    const token = jwt({ exp: (NOW + REFRESH_SKEW_MS + 1_000) / 1000 });
    expect(isTokenExpired(token, NOW)).toBe(false);
  });

  it('does NOT treat an unreadable token as expired', () => {
    // The server is the authority on an unrecognised token. Clearing it here
    // would sign the user out over a shape we simply do not parse.
    expect(isTokenExpired('not-a-jwt', NOW)).toBe(false);
    expect(isTokenExpired(jwt({ sub: 'x' }), NOW)).toBe(false);
  });
});

describe('refreshDelayMs', () => {
  it('schedules one skew-width before expiry', () => {
    const expiry = NOW + 10 * 60_000;
    expect(refreshDelayMs(expiry, NOW)).toBe(10 * 60_000 - REFRESH_SKEW_MS);
  });

  it('handles the real WorkOS case — a five minute token', () => {
    const expiry = NOW + 5 * 60_000;
    // Renewed at four minutes, comfortably inside a six minute segment.
    expect(refreshDelayMs(expiry, NOW)).toBe(4 * 60_000);
  });

  it('never returns less than the floor, even for an already-expired token', () => {
    expect(refreshDelayMs(NOW - 60_000, NOW)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it('never returns less than the floor for a token shorter than the skew', () => {
    // A 10s token would otherwise schedule in the past and spin.
    expect(refreshDelayMs(NOW + 10_000, NOW)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it('is never negative', () => {
    for (const offset of [-10 * 60_000, -1, 0, 1, 60_000, 3_600_000]) {
      expect(refreshDelayMs(NOW + offset, NOW)).toBeGreaterThanOrEqual(0);
    }
  });
});
