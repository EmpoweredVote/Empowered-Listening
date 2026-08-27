import { jwtVerify, createRemoteJWKSet, decodeJwt, type JWTPayload } from 'jose';

/**
 * Token verification for TWO issuers during the Supabase Auth → WorkOS AuthKit
 * migration (ev-accounts decision 0002).
 *
 * - Supabase (legacy): audience 'authenticated', ES256; userId = payload.sub.
 * - WorkOS AuthKit: RS256, no audience check (WorkOS tokens carry no `aud`),
 *   but the dashboard JWT template must set role = 'authenticated';
 *   userId = payload.external_id — the internal id assigned at import/provision.
 *   The WorkOS `sub` is a WorkOS-side id and is NEVER used as the user id.
 *
 * If WORKOS_CLIENT_ID is not configured, the WorkOS branch is disabled and
 * WorkOS-issued tokens are rejected (old behavior).
 */

// --- Supabase (legacy issuer) -----------------------------------------------

const SUPABASE_ISSUER = 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1';

const JWKS_URL = new URL(
  process.env.JWKS_URL ?? 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json'
);

export const JWKS = createRemoteJWKSet(JWKS_URL);

// --- WorkOS AuthKit (second issuer, decision 0002) --------------------------

const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID;

const WORKOS_ISSUER = WORKOS_CLIENT_ID
  ? process.env.WORKOS_ISSUER ?? `https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`
  : undefined;

const WORKOS_JWKS = WORKOS_CLIENT_ID
  ? createRemoteJWKSet(
      new URL(
        process.env.WORKOS_JWKS_URL ?? `https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`
      )
    )
  : undefined;

// -----------------------------------------------------------------------------

export interface VerifiedToken {
  payload: JWTPayload;
  /**
   * Internal user id. Supabase tokens: `sub`. WorkOS tokens: `external_id`
   * (never the WorkOS `sub`).
   */
  userId: string;
}

export async function verifyToken(token: string): Promise<VerifiedToken> {
  // Unverified decode, used ONLY to pick which issuer to verify against.
  // The actual verification below checks the issuer strictly.
  const { iss } = decodeJwt(token);

  if (iss === SUPABASE_ISSUER) {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: SUPABASE_ISSUER,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new Error('Token has no sub claim');
    }
    return { payload, userId: payload.sub };
  }

  if (WORKOS_ISSUER !== undefined && WORKOS_JWKS !== undefined && iss === WORKOS_ISSUER) {
    // No audience check: WorkOS access tokens carry no `aud` claim.
    const { payload } = await jwtVerify(token, WORKOS_JWKS, {
      issuer: WORKOS_ISSUER,
      algorithms: ['RS256'],
    });
    // The WorkOS dashboard JWT template sets role = 'authenticated'.
    if (payload.role !== 'authenticated') {
      throw new Error('WorkOS token missing role=authenticated');
    }
    const externalId = payload.external_id;
    if (typeof externalId !== 'string' || externalId === '') {
      throw new Error('WorkOS token missing external_id');
    }
    return { payload, userId: externalId };
  }

  throw new Error(`Unknown token issuer: ${iss ?? '(none)'}`);
}
