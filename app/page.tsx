'use client';

import { useSession } from '@/components/auth/SessionProvider';
import { LoginButton } from '@/components/auth/LoginButton';

export default function HomePage() {
  const { displayName, loading } = useSession();

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-8">
      <header className="text-center space-y-3 max-w-xl">
        <h1 className="text-4xl font-semibold text-ev-muted-blue">Empowered Listening</h1>
        <p className="text-lg text-slate-700">
          Structured civic debate.  Fair speakers, accountable timing, a searchable record.
        </p>
      </header>
      {displayName ? (
        <p className="text-base text-slate-700">
          Signed in as <strong>{displayName}</strong>
        </p>
      ) : (
        <LoginButton />
      )}
    </main>
  );
}
