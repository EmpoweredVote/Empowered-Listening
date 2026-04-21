import { cache } from 'react';

export type AccountMe = {
  id: string;
  display_name: string;
  tier: 'inform' | 'connected' | 'empowered';
  account_standing: 'active' | 'suspended' | 'restricted';
  connected_profile?: unknown;
};

export const getAccountMe = cache(async (accessToken: string): Promise<AccountMe> => {
  const res = await fetch('https://api.empowered.vote/api/account/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`/api/account/me returned ${res.status}`);
  return res.json();
});

export function isStandingActive(account: AccountMe): boolean {
  return account.account_standing === 'active';
}
