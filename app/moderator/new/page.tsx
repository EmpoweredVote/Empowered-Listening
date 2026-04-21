import { CreateDebateForm } from './CreateDebateForm';

export default function NewDebatePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-ev-muted-blue">Create a debate</h1>
      <p className="mt-2 text-slate-600">
        Fill out the topic and the two speakers&apos; display names.  You&apos;ll get share links
        for each speaker on the next screen.
      </p>
      <CreateDebateForm />
    </main>
  );
}
