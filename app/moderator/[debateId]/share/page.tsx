import { ShareLinks } from './ShareLinks';

/**
 * The share page renders no debate data server-side on purpose.
 *
 * It used to query the pool and print every speaker slot id with no auth
 * check. A slot id is the capability to claim that seat, and the observer
 * route `/debates/[debateId]` is anonymous by design, so the debate id is
 * public — which made the unclaimed affirmative and negative seats readable
 * by any signed-in account that had the audience link. The links now come
 * from GET /api/debates/[debateId]/share-links, which requires the
 * listening_moderator role and ownership of the debate.
 */
export default async function ShareDebatePage({
  params,
}: {
  params: Promise<{ debateId: string }>;
}) {
  const { debateId } = await params;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-ev-muted-blue">Debate created</h1>
      <p className="mt-2 text-slate-600">
        Share the speaker links below with your two speakers.  Use the moderator link yourself when
        you&apos;re ready to run the debate.  Treat them as private — whoever opens a speaker link
        first takes that seat.
      </p>
      <ShareLinks debateId={debateId} />
    </main>
  );
}
