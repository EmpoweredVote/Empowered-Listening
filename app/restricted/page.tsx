export default function RestrictedPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-6 text-center max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-ev-muted-blue">Account restricted</h1>
      <p className="text-base text-slate-700">
        Your account is currently restricted from participating.  Contact{' '}
        <a href="mailto:support@empowered.vote" className="text-ev-muted-blue underline">
          support@empowered.vote
        </a>{' '}
        if you believe this is an error.
      </p>
    </main>
  );
}
