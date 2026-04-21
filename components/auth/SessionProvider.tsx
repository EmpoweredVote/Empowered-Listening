'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { tryRenewSession } from '@/lib/auth/session';

type SessionState = {
  token: string | null;
  displayName: string | null;
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ token: null, displayName: null, loading: true });

export function useSession() {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ token: null, displayName: null, loading: true });

  useEffect(() => {
    async function init() {
      if (window.location.hash.includes('access_token=')) {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const hashToken = params.get('access_token');
        if (hashToken) {
          localStorage.setItem('ev_token', hashToken);
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }

      let token = localStorage.getItem('ev_token');

      if (!token) {
        token = await tryRenewSession();
        if (token) localStorage.setItem('ev_token', token);
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
            localStorage.removeItem('ev_token');
            token = null;
          }
        } catch {
          // Network error; leave as-is.
        }
      }

      setState({ token, displayName, loading: false });
    }
    init();
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
