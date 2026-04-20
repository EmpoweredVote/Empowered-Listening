import Link from 'next/link';

export default function HomePage() {
  const loginUrl =
    'https://accounts.empowered.vote/login?redirect=' +
    encodeURIComponent('https://listening.empowered.vote');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-8">
      <header className="text-center space-y-3 max-w-xl">
        <h1 className="text-4xl font-semibold text-ev-muted-blue">Empowered Listening</h1>
        <p className="text-lg text-slate-700">
          Structured civic debate.  Fair speakers, accountable timing, a searchable record.
        </p>
      </header>
      <Link
        href={loginUrl}
        className="inline-flex items-center justify-center rounded-md bg-ev-muted-blue px-6 py-3 text-white font-medium hover:opacity-90 transition"
      >
        Log in via Empowered
      </Link>
    </main>
  );
}
