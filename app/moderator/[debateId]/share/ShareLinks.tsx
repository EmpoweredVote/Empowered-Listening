'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/auth/SessionProvider';
import { CopyLinkRow } from './CopyLinkRow';

interface SpeakerRow {
  id: string;
  role: 'affirmative' | 'negative' | 'moderator';
  display_name: string;
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; speakers: SpeakerRow[] }
  | { status: 'denied' }
  | { status: 'error' };

/**
 * Fetches the debate's join links for the moderator who created it.
 *
 * These links carry speaker slot ids, and a slot id is what claims the seat
 * (see the share-links route). They are therefore fetched with a bearer token
 * rather than rendered server-side, because this app keeps its JWT in
 * localStorage (`ev_token`) and never in a cookie — middleware and server
 * components cannot see it, so the gate has to live in the API.
 */
export function ShareLinks({ debateId }: { debateId: string }) {
  // Read the session through the provider rather than localStorage directly:
  // a moderator arriving straight from accounts.empowered.vote still has the
  // token in the URL hash, and SessionProvider is what moves it into storage
  // (and silently renews it). Reading storage here would show a spurious
  // "denied" on that first paint.
  const { token, loading } = useSession();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    async function resolve(): Promise<State> {
      if (!token) return { status: 'denied' };

      const res = await fetch(`/api/debates/${debateId}/share-links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 404 covers "not yours" as well as "no such debate" — see the route.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { status: 'denied' };
      }
      if (!res.ok) return { status: 'error' };

      const data = (await res.json()) as { speakers: SpeakerRow[] };
      return { status: 'ok', speakers: data.speakers };
    }

    resolve()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [debateId, token, loading]);

  if (state.status === 'loading') {
    return <p className="mt-8 text-sm text-slate-500">Loading join links…</p>;
  }

  if (state.status === 'denied') {
    return (
      <p className="mt-8 rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        These join links are only visible to the moderator who created this debate.
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p className="mt-8 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load the join links. Reload the page to try again.
      </p>
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_ORIGIN ??
    (typeof window === 'undefined' ? 'https://listening.empowered.vote' : window.location.origin);
  const byRole = Object.fromEntries(state.speakers.map((s) => [s.role, s])) as Record<
    string,
    SpeakerRow | undefined
  >;

  const affirmative = byRole.affirmative;
  const negative = byRole.negative;
  const moderator = byRole.moderator;

  return (
    <section className="mt-8 space-y-4">
      {affirmative && (
        <CopyLinkRow
          label={`Affirmative: ${affirmative.display_name}`}
          url={`${origin}/join/speaker/${debateId}?s=${affirmative.id}`}
        />
      )}
      {negative && (
        <CopyLinkRow
          label={`Negative: ${negative.display_name}`}
          url={`${origin}/join/speaker/${debateId}?s=${negative.id}`}
        />
      )}
      {moderator && (
        <CopyLinkRow
          label="Moderator (you)"
          url={`${origin}/join/moderator/${debateId}?s=${moderator.id}`}
        />
      )}
    </section>
  );
}
