'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/auth/SessionProvider';
import { useDebateStore } from '@/store/debateStore';
import { userIdFromToken } from '@/lib/auth/user-id';
import { resolveParticipantRole } from '@/lib/debate/user-role';

export type { UserRole } from '@/lib/debate/user-role';
import type { UserRole } from '@/lib/debate/user-role';
type Tier = 'inform' | 'connected' | 'empowered';

export interface UserRoleState {
  userId: string | null;
  displayName: string | null;
  userRole: UserRole;
  tier: Tier | null;
  token: string | null;
  loading: boolean;
}

/**
 * Derives the user's role within the debate context.
 *
 * Role resolution order:
 *   1. anonymous   — no token present (or session still loading)
 *   2. moderator   — userId holds a debate_speakers seat with role=moderator
 *   3. speaker     — userId holds a seat with role=affirmative or negative
 *   4. observer    — token present, but no seat above (panelist included)
 *
 * Steps 2-4 live in lib/debate/user-role.ts, which is where the precedence
 * among several seats is applied.  This comment described that precedence
 * long before the code had it — see issue #100.
 *
 * Tier is fetched from /api/account/me and cached in component state.
 * Only called when a token is available.
 */
export function useUserRole(): UserRoleState {
  const { token, displayName, loading: sessionLoading } = useSession();
  const speakers = useDebateStore((s) => s.speakers);

  // Decode the token to extract the INTERNAL user id.  This must be
  // `external_id` first and `sub` second (ev-accounts decision 0002): under a
  // WorkOS token `sub` is a WorkOS id and matches no `debate_speakers.user_id`,
  // which would silently demote every speaker and moderator to 'observer'.
  // See lib/auth/user-id.ts.
  const userId = useMemo(() => userIdFromToken(token), [token]);

  // Tier result, tagged with the token it was fetched for.  A result for any
  // other token is ignored, so tier and loading are derived, not reset in effects.
  const [tierResult, setTierResult] = useState<{ token: string; tier: Tier | null } | null>(null);

  // Fetch tier from /api/account/me when token is present
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    fetch('https://api.empowered.vote/api/account/me', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ tier: Tier }>;
      })
      .then((data) => {
        if (!cancelled) setTierResult({ token, tier: data?.tier ?? null });
      })
      .catch(() => {
        if (!cancelled) setTierResult({ token, tier: null });
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const tierFetched = !!token && tierResult?.token === token;
  const tier = tierFetched ? tierResult.tier : null;
  const tierLoading = !!token && !tierFetched;

  // Derive userRole from userId + the debate's seats.  Anonymous is decided
  // here, because it is a fact about the session rather than about the seats.
  const userRole: UserRole =
    !sessionLoading && token && userId
      ? resolveParticipantRole(Object.values(speakers), userId)
      : 'anonymous';

  const loading = sessionLoading || tierLoading;

  return {
    userId,
    displayName,
    userRole,
    tier,
    token,
    loading,
  };
}
