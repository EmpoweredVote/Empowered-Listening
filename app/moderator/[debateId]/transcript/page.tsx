import { TranscriptReview } from './TranscriptReview';

/**
 * The transcript review page renders no debate data server-side, on purpose.
 *
 * It used to query the pool directly — every entry, every `original_text`,
 * and the moderator's name — with no auth check of any kind. The observer
 * route `/debates/[debateId]` is anonymous by design, so a debate id is
 * effectively public, which made any debate's full transcript and every
 * pre-correction original readable by anyone who had one. A server component
 * could not have fixed this in place: this app keeps its JWT in localStorage
 * (`ev_token`), never a cookie, so nothing on the server knows who is asking.
 *
 * The data now comes from GET /api/moderator/debates/[debateId]/transcript,
 * which requires the caller to hold this debate's moderator speaker row —
 * the same check `correct_transcript_entry` already made for edits. The share
 * page was fixed the same way and for the same reason.
 */
export default async function ModeratorTranscriptPage({
  params,
}: {
  params: Promise<{ debateId: string }>;
}) {
  const { debateId } = await params;

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Transcript Review</h1>
        <p className="mt-1 text-sm text-slate-400">
          Click any entry to edit.  Originals are preserved.
        </p>
        <a
          href={`/moderator/${debateId}`}
          className="mt-2 inline-block text-sm text-blue-400 hover:underline"
        >
          &larr; Back to debate
        </a>
      </header>

      <div className="mx-auto max-w-3xl">
        <TranscriptReview debateId={debateId} />
      </div>
    </div>
  );
}
