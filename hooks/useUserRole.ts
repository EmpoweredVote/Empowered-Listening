'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/auth/SessionProvider';
import { useDebateStore } from '@/store/debateStore';
import { decodeJwt } from 'jose';

export type UserRole = 'observer' | 'speaker' | 'moderator' | 'anonymous';

export interface UserRoleState {
  userId: string | null;
  displayName: string | null;
  userRole: UserRole;
  tier: 'inform' | 'connected' | 'empowered' | null;
  token: string | null;
  loading: boolean;
}

/**
 * Derives the user's role within the debate context.
 *
 * Role resolution order:
 *   1. anonymous   — no token present (or session still loading)
 *   2. moderator   — userId matches a debate_speaker with role=moderator
 *   3. speaker     — userId matches a debate_speaker with role=affirmative or negative
 *   4. observer    — token present but not a debate participant
 *
 * Tier is fetched from /api/account/me and cached in component state.
 * Only called when a token is available.
 */
export function useUserRole(): UserRoleState {
  const { token, displayName, loading: sessionLoading } = useSession();
  const speakers = useDebateStore((s) => s.speakers);

  const [userId, setUserId] = useState<string | null>(null);
  const [tier, setTier] = useState<'inform' | 'connected' | 'empowered' | null>(null);
  const [tierLoading, setTierLoading] = useState(false);

  // Decode token to extract userId (sub claim)
  useEffect(() => {
    if (!token) {
      setUserId(null);
      return;
    }
    try {
      const claims = decodeJwt(token);
      setUserId((claims.sub as string) ?? null);
    } catch {
      setUserId(null);
    }
  }, [token]);

  // Fetch tier from /api/account/me when token is present
  useEffect(() => {
    if (!token) {
      setTier(null);
      return;
    }

    let cancelled = false;
    setTierLoading(true);

    fetch('https://api.empowered.vote/api/account/me', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ tier: 'inform' | 'connected' | 'empowered' }>;
      })
      .then((data) => {
        if (!cancelled) {
          setTier(data?.tier ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setTier(null);
      })
      .finally(() => {
        if (!cancelled) setTierLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Derive userRole from userId + speakers list
  let userRole: UserRole = 'anonymous';
  if (!sessionLoading && token && userId) {
    const speakerList = Object.values(speakers);
    const match = speakerList.find((s) => s.user_id === userId);
    if (match) {
      if (match.role === 'moderator') {
        userRole = 'moderator';
      } else if (match.role === 'affirmative' || match.role === 'negative') {
        userRole = 'speaker';
      } else {
        userRole = 'observer';
      }
    } else {
      userRole = 'observer';
    }
  }

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
