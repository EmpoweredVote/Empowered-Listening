/// <reference types="vitest/globals" />
import { userIdFromToken } from './user-id';

/** Builds an unsigned JWT with the given claims. decodeJwt does not verify. */
function tokenWith(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

const INTERNAL_UUID = '11111111-2222-3333-4444-555555555555';
const WORKOS_SUB = 'user_01JABCDEFGHIJKLMNOPQRSTUV';

describe('userIdFromToken', () => {
  it('returns sub for a legacy Supabase token (sub IS the internal UUID)', () => {
    const token = tokenWith({
      iss: 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1',
      sub: INTERNAL_UUID,
      aud: 'authenticated',
    });
    expect(userIdFromToken(token)).toBe(INTERNAL_UUID);
  });

  it('returns external_id for a WorkOS token, NEVER the WorkOS sub', () => {
    const token = tokenWith({
      iss: 'https://api.workos.com/user_management/client_123',
      sub: WORKOS_SUB,
      external_id: INTERNAL_UUID,
      role: 'authenticated',
    });
    const resolved = userIdFromToken(token);
    expect(resolved).toBe(INTERNAL_UUID);
    expect(resolved).not.toBe(WORKOS_SUB);
  });

  it('prefers external_id even when both claims are present', () => {
    const token = tokenWith({ sub: WORKOS_SUB, external_id: INTERNAL_UUID });
    expect(userIdFromToken(token)).toBe(INTERNAL_UUID);
  });

  it('falls back to sub when external_id is absent', () => {
    expect(userIdFromToken(tokenWith({ sub: INTERNAL_UUID }))).toBe(INTERNAL_UUID);
  });

  it('ignores a non-string or empty external_id and falls back to sub', () => {
    expect(userIdFromToken(tokenWith({ sub: INTERNAL_UUID, external_id: '' }))).toBe(INTERNAL_UUID);
    expect(userIdFromToken(tokenWith({ sub: INTERNAL_UUID, external_id: 42 }))).toBe(INTERNAL_UUID);
    expect(userIdFromToken(tokenWith({ sub: INTERNAL_UUID, external_id: null }))).toBe(INTERNAL_UUID);
  });

  it('returns the WorkOS sub for an unlinked account, which then matches no speaker row', () => {
    // Fail-closed is the intent, but this layer cannot tell a WorkOS sub from a
    // UUID without the issuer; it returns the sub and the speaker match fails,
    // which is the same visible outcome: no speaker UI.
    const token = tokenWith({ sub: WORKOS_SUB });
    expect(userIdFromToken(token)).toBe(WORKOS_SUB);
  });

  it('returns null for absent, empty, malformed, or claimless tokens', () => {
    expect(userIdFromToken(null)).toBeNull();
    expect(userIdFromToken(undefined)).toBeNull();
    expect(userIdFromToken('')).toBeNull();
    expect(userIdFromToken('not-a-jwt')).toBeNull();
    expect(userIdFromToken(tokenWith({ iss: 'x' }))).toBeNull();
  });
});
