'use client';

import { useEffect, useState } from 'react';
import { DebateRoom } from '@/components/debate/DebateRoom';
import type { DebateSpeakerInfo } from '@/components/debate/ParticipantGrid';

interface Props {
  debateId: string;
  speakerId: string;
  speakers: DebateSpeakerInfo[];
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; token: string; serverUrl: string };

export function ModeratorJoinClient({ debateId, speakerId, speakers }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const ev = localStorage.getItem('ev_token');
    if (!ev) {
      window.location.href = `https://accounts.empowered.vote/login?redirect=${encodeURIComponent(window.location.href)}`;
      return;
    }
    fetch(`/api/debates/${debateId}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ev}` },
      body: JSON.stringify({ speakerId }),
    })
      .then(r =>
        r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(`${r.status}: ${t}`))),
      )
      .then((data: { token: string; serverUrl: string }) =>
        setState({ status: 'ready', token: data.token, serverUrl: data.serverUrl }),
      )
      .catch((e: Error) => setState({ status: 'error', message: e.message }));
  }, [debateId, speakerId]);

  if (state.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Connecting to debate room...</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-red-700">Cannot join: {state.message}</p>
      </main>
    );
  }

  return (
    <DebateRoom
      debateId={debateId}
      token={state.token}
      serverUrl={state.serverUrl}
      speakers={speakers}
      isModerator={true}
    />
  );
}
