'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface FormState {
  topic: string;
  affirmativeName: string;
  negativeName: string;
}

type SubmitState = 'loading-role' | 'unauthorized' | 'ready' | 'submitting' | 'error';

export function CreateDebateForm() {
  const router = useRouter();
  const [submitState, setSubmitState] = useState<SubmitState>('loading-role');
  const [moderatorDisplayName, setModeratorDisplayName] = useState('Moderator');
  const [state, setState] = useState<FormState>({ topic: '', affirmativeName: '', negativeName: '' });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('ev_token');
    if (!token) { setSubmitState('unauthorized'); return; }
    fetch('https://api.empowered.vote/api/account/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
      .then((acct: Record<string, unknown>) => {
        // Check both JWT role claim locations
        const appMetaRoles = (acct?.app_metadata as { roles?: string[] } | undefined)?.roles;
        const topRoles = acct?.roles as string[] | undefined;
        const roles: string[] = appMetaRoles ?? topRoles ?? [];
        if (roles.includes('listening_moderator')) {
          setModeratorDisplayName((acct.display_name as string | undefined) ?? 'Moderator');
          setSubmitState('ready');
        } else {
          setSubmitState('unauthorized');
        }
      })
      .catch(() => setSubmitState('unauthorized'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitState('submitting');
    setErrorMsg(null);
    const token = localStorage.getItem('ev_token');
    const res = await fetch('/api/debates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...state, moderatorDisplayName }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error');
      setErrorMsg(body);
      setSubmitState('error');
      return;
    }
    const result = await res.json() as { debateId: string };
    router.push(`/moderator/${result.debateId}/share`);
  }

  if (submitState === 'loading-role') {
    return <p className="mt-6 text-slate-500">Checking your access...</p>;
  }
  if (submitState === 'unauthorized') {
    return (
      <p className="mt-6 rounded bg-amber-50 p-4 text-amber-900">
        You need the moderator role to create debates.  Contact support@empowered.vote if this is unexpected.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Debate topic</span>
        <input
          required minLength={3} maxLength={200}
          value={state.topic}
          onChange={e => setState(s => ({ ...s, topic: e.target.value }))}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ev-muted-blue"
          placeholder="e.g. Indiana should raise the minimum wage to $15 by 2028"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Affirmative speaker name</span>
        <input
          required minLength={1} maxLength={80}
          value={state.affirmativeName}
          onChange={e => setState(s => ({ ...s, affirmativeName: e.target.value }))}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ev-muted-blue"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Negative speaker name</span>
        <input
          required minLength={1} maxLength={80}
          value={state.negativeName}
          onChange={e => setState(s => ({ ...s, negativeName: e.target.value }))}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ev-muted-blue"
        />
      </label>

      {(submitState === 'error') && errorMsg && (
        <p className="text-sm text-red-600">Error: {errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={submitState === 'submitting'}
        className="rounded bg-ev-muted-blue px-5 py-2 text-sm text-white disabled:opacity-60"
      >
        {submitState === 'submitting' ? 'Creating...' : 'Create debate'}
      </button>
    </form>
  );
}
