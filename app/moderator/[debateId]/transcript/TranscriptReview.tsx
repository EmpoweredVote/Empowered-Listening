'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/auth/SessionProvider';
import { TranscriptEditor } from '@/components/transcript/moderator/TranscriptEditor';
import type { ModeratorTranscriptEntry } from '@/app/api/moderator/debates/[debateId]/transcript/route';

type State =
  | { status: 'loading' }
  | { status: 'ok'; entries: ModeratorTranscriptEntry[]; moderatorName: string }
  | { status: 'denied' }
  | { status: 'error' };

/**
 * Loads the transcript for review.
 *
 * Fetched with a bearer token rather than rendered server-side, for the same
 * reason the share page moved: this app keeps its JWT in localStorage
 * (`ev_token`), never a cookie, so a server component has no way to know who
 * is asking. The previous server component therefore had no auth check at
 * all, and handed out every debate's transcript — including `original_text`,
 * the unedited speech — to anyone with a debate id.
 */
export function TranscriptReview({ debateId }: { debateId: string }) {
  // Through the provider, not localStorage: a moderator arriving from
  // accounts.empowered.vote still has the token in the URL hash on first
  // paint, and reading storage directly would flash a spurious "denied".
  const { token, loading } = useSession();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    async function resolve(): Promise<State | 'redirected'> {
      if (!token) return { status: 'denied' };

      const res = await fetch(`/api/moderator/debates/${debateId}/transcript`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      // 404 covers "not your debate" as well as "no such debate" — see the route.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { status: 'denied' };
      }
      if (!res.ok) return { status: 'error' };

      const data = (await res.json()) as {
        status: string;
        moderatorName: string;
        entries: ModeratorTranscriptEntry[] | null;
      };

      // Still running: back to the debate, same as the old page did.
      if (data.entries === null) {
        router.replace(`/moderator/${debateId}`);
        return 'redirected';
      }

      return { status: 'ok', entries: data.entries, moderatorName: data.moderatorName };
    }

    resolve()
      .then(next => {
        if (!cancelled && next !== 'redirected') setState(next);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => { cancelled = true; };
  }, [debateId, token, loading, router]);

  if (state.status === 'loading') {
    return <p className="text-slate-500">Loading transcript…</p>;
  }

  if (state.status === 'denied') {
    return (
      <p className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        This transcript is only visible to the moderator of this debate.
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p className="rounded border border-red-900 bg-red-950 p-4 text-sm text-red-300">
        Could not load the transcript. Reload the page to try again.
      </p>
    );
  }

  if (state.entries.length === 0) {
    return <p className="text-slate-500">No transcript entries found for this debate.</p>;
  }

  return (
    <div className="space-y-0 divide-y divide-slate-800">
      {state.entries.map(entry => {
        const speaker =
          entry.display_name && entry.speaker_role
            ? { displayName: entry.display_name, role: entry.speaker_role }
            : undefined;

        return (
          <TranscriptEditor
            key={entry.id}
            entry={{
              id: entry.id,
              debate_id: entry.debate_id,
              speaker_id: entry.speaker_id,
              spoken_at: entry.spoken_at,
              debate_time_mmss: entry.debate_time_mmss,
              text: entry.text,
              original_text: entry.original_text,
              edited: entry.edited,
              edited_at: entry.edited_at,
              edited_by: entry.edited_by,
            }}
            speaker={speaker}
            editorName={state.moderatorName}
          />
        );
      })}
    </div>
  );
}
