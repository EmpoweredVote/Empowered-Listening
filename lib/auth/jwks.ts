import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

const JWKS_URL = new URL(
  process.env.JWKS_URL ?? 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json'
);

export const JWKS = createRemoteJWKSet(JWKS_URL);

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1',
    audience: 'authenticated',
    algorithms: ['ES256'],
  });
  return payload;
}
