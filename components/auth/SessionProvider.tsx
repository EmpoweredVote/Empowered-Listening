'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { tryRenewSession } from '@/lib/auth/session';
import { isTokenExpired, refreshDelayMs, tokenExpiryMs } from '@/lib/auth/token-expiry';

type SessionState = {
  token: string | null;
  displayName: string | null;
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ token: null, displayName: null, loading: true });

export function useSession() {
  return useContext(SessionContext);
}

/**
 * Holds a live session token for the length of a debate.
 *
 * This used to run once on mount and never again, and it called
 * `tryRenewSession()` ONLY when localStorage held no token at all. WorkOS
 * AuthKit access tokens last minutes, so an expired one sat in localStorage
 * looking exactly like a good one: every request failed, nothing renewed, and
 * the only way back was to clear the key by hand and sign in again.
 *
 * It made the app unusable for the thing it exists to do. A Lincoln-Douglas
 * debate is 32 speaking minutes plus prep; the moderator's token expired
 * repeatedly before the first segment ended, and each failure read as a
 * permissions problem rather than an expiry.
 *
 * So the token is now kept fresh on a timer. Every other call site reads
 * `localStorage.getItem('ev_token')` at the moment it needs it — a dozen of
 * them — so refreshing that one key centrally fixes all of them without
 * touching any.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ token: null, displayName: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function store(token: string | null) {
      if (token) localStorage.setItem('ev_token', token);
      else localStorage.removeItem('ev_token');
    }

    /** Arm the next renewal. Called after every token change. */
    function schedule(token: string | null) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!token) return;

      const expiryMs = tokenExpiryMs(token);
      // A token we cannot read gets no timer; the server still decides whether
      // it is good, and a 401 is recoverable by signing in again.
      if (expiryMs === null) return;

      timer = setTimeout(() => void renew(), refreshDelayMs(expiryMs, Date.now()));
    }

    async function renew() {
      const fresh = await tryRenewSession();
      if (cancelled) return;

      if (fresh) {
        store(fresh);
        setState(s => ({ ...s, token: fresh }));
        schedule(fresh);
        return;
      }

      // The renewal endpoint said no — the underlying session is gone, not just
      // the access token. Drop the dead token so the UI shows signed-out rather
      // than failing every request with a token that cannot work.
      store(null);
      setState(s => ({ ...s, token: null }));
    }

    /**
     * A tab that was asleep gets its timer fired late, or not at all. Re-check
     * on the way back — a moderator returning to a backgrounded debate tab is
     * exactly the case that must not be holding a dead token.
     */
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (isTokenExpired(localStorage.getItem('ev_token'))) void renew();
    }

    async function init() {
      if (window.location.hash.includes('access_token=')) {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const hashToken = params.get('access_token');
        if (hashToken) {
          store(hashToken);
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }

      let token = localStorage.getItem('ev_token');

      // An expired token is worth no more than no token. Previously this check
      // did not exist, so a dead token short-circuited the renewal below and
      // the session never recovered on its own.
      if (isTokenExpired(token)) {
        store(null);
        token = null;
      }

      if (!token) {
        token = await tryRenewSession();
        store(token);
      }

      let displayName: string | null = null;
      if (token) {
        try {
          const res = await fetch('https://api.empowered.vote/api/account/me', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });
          if (res.ok) {
            const account = await res.json();
            displayName = account.display_name;
          } else if (res.status === 401) {
            // Rejected despite looking live — try once for a fresh one before
            // giving up, rather than signing the user out outright.
            const fresh = await tryRenewSession();
            store(fresh);
            token = fresh;
          }
        } catch {
          // Network error; leave as-is.
        }
      }

      if (cancelled) return;
      setState({ token, displayName, loading: false });
      schedule(token);
    }

    void init();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
