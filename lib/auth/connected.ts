import { getAccountMe, type AccountMe } from '@/lib/auth/account';

class TierError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Verifies the bearer token belongs to a Connected or Empowered account
 * in good standing.  Throws a TierError on failure so callers can use
 * mapTierError() to produce uniform HTTP responses.
 */
export async function requireConnectedTier(accessToken: string): Promise<AccountMe> {
  const account = await getAccountMe(accessToken);

  if (account.tier === 'inform') {
    throw new TierError('Connected account required', 'INFORM_TIER');
  }

  if (account.account_standing !== 'active') {
    throw new TierError('Account standing prevents this action', 'STANDING');
  }

  return account;
}

/**
 * Converts a TierError (or any error) into a { status, body } shape that
 * route handlers can return directly.
 */
export function mapTierError(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof TierError) {
    if (err.code === 'INFORM_TIER') {
      return { status: 403, body: { error: 'Connected account required' } };
    }
    if (err.code === 'STANDING') {
      return { status: 403, body: { error: 'Account standing prevents this action' } };
    }
  }
  return { status: 500, body: { error: 'Internal error' } };
}
