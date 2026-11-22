'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/auth/SessionProvider';
import { LoginButton } from '@/components/auth/LoginButton';

type GateState = 'checking' | 'allowed' | 'anonymous' | 'denied' | 'unreachable';
type Answer = Exclude<GateState, 'checking'>;

/**
 * The gate in front of every `/moderator/*` page.
 *
 * **This is a rendering decision, not a security boundary.**  Every moderator
 * API route runs the real gate for itself, and the pages behind this one
 * deliberately render no debate data server-side.  Without this, someone
 * without the role sees a page shell whose fetches then fail — which looks
 * like the app is broken rather than like a door that is closed.
 *
 * It cannot be `middleware.ts`.  This app keeps its JWT in localStorage
 * (`ev_token`) and never in a cookie, so middleware — which sees only cookies
 * and headers — never learns who is asking.  A real server-side gate would
 * mean moving the token to a cookie, which is an architectural change and
 * brings CSRF into scope.
 *
 * The session is read through the provider rather than from localStorage: a
 * moderator arriving straight from accounts.empowered.vote still has the token
 * in the URL hash, and SessionProvider is what moves it into storage.  Reading
 * storage here would show a spurious "sign in" on that first paint.
 */
function stateForStatus(status: number): Answer {
  if (status === 403) return 'denied';
  if (status === 401) return 'anonymous';
  // Anything else is the server having a bad day, not an answer about this
  // user.  Saying "you do not have the role" there would be a lie.
  return 'unreachable';
}

export function ModeratorGate({ children }: { children: React.ReactNode }) {
  const { token, loading } = useSession();

  // Tagged with the token it was fetched for, so an answer about any other
  // token is ignored and the displayed state is derived rather than reset in
  // an effect.  Same shape as the tier fetch in hooks/useUserRole.ts.
  const [answer, setAnswer] = useState<{ token: string; state: Answer } | null>(null);

  useEffect(() => {
    if (loading || !token) return;

    let cancelled = false;

    fetch('/api/moderator/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!cancelled) setAnswer({ token, state: res.ok ? 'allowed' : stateForStatus(res.status) });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ token, state: 'unreachable' });
      });

    return () => {
      cancelled = true;
    };
  }, [token, loading]);

  const state: GateState = loading
    ? 'checking'
    : !token
      ? 'anonymous'
      : answer?.token === token
        ? answer.state
        : 'checking';

  if (state === 'allowed') return <>{children}</>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      {state === 'checking' && <p className="text-slate-500">Checking your access...</p>}

      {state === 'anonymous' && (
        <>
          <h1 className="text-2xl font-semibold text-ev-muted-blue">Moderator sign-in required</h1>
          <p className="mt-2 text-slate-600">
            Moderator tools are for the account that runs the debate.  Log in and you&apos;ll come
            straight back here.
          </p>
          <div className="mt-6">
            <LoginButton />
          </div>
        </>
      )}

      {state === 'denied' && (
        <>
          <h1 className="text-2xl font-semibold text-ev-muted-blue">You need the moderator role</h1>
          <p className="mt-2 rounded bg-amber-50 p-4 text-amber-900">
            You&apos;re signed in, but this account doesn&apos;t hold the moderator role.  Contact
            support@empowered.vote if that&apos;s unexpected.
          </p>
        </>
      )}

      {state === 'unreachable' && (
        <>
          <h1 className="text-2xl font-semibold text-ev-muted-blue">Couldn&apos;t check your access</h1>
          <p className="mt-2 rounded bg-amber-50 p-4 text-amber-900">
            Something went wrong on our side, so we can&apos;t tell whether you have the moderator
            role.  Reload to try again.
          </p>
        </>
      )}
    </main>
  );
}
