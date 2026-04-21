import { notFound } from 'next/navigation';
import { getPool } from '@/lib/db/pool';
import { CopyLinkRow } from './CopyLinkRow';

interface SpeakerRow {
  id: string;
  role: 'affirmative' | 'negative' | 'moderator';
  display_name: string;
}

export default async function ShareDebatePage({
  params,
}: {
  params: Promise<{ debateId: string }>;
}) {
  const { debateId } = await params;
  const pool = getPool();
  const { rows } = await pool.query<SpeakerRow>(
    `SELECT id, role, display_name FROM listening.debate_speakers WHERE debate_id = $1 ORDER BY role`,
    [debateId],
  );
  if (rows.length === 0) notFound();

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://listening.empowered.vote';
  const byRole = Object.fromEntries(rows.map(r => [r.role, r])) as Record<string, SpeakerRow>;

  const affLink = `${origin}/join/speaker/${debateId}?s=${byRole.affirmative?.id}`;
  const negLink = `${origin}/join/speaker/${debateId}?s=${byRole.negative?.id}`;
  const modLink = `${origin}/join/moderator/${debateId}?s=${byRole.moderator?.id}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-ev-muted-blue">Debate created</h1>
      <p className="mt-2 text-slate-600">
        Share the speaker links below with your two speakers.  Use the moderator link yourself when
        you&apos;re ready to run the debate.
      </p>
      <section className="mt-8 space-y-4">
        <CopyLinkRow label={`Affirmative: ${byRole.affirmative?.display_name ?? ''}`} url={affLink} />
        <CopyLinkRow label={`Negative: ${byRole.negative?.display_name ?? ''}`} url={negLink} />
        <CopyLinkRow label="Moderator (you)" url={modLink} />
      </section>
    </main>
  );
}
