import { notFound } from 'next/navigation';
import { pool } from '@/lib/db/pool';
import ObserverShell from './ObserverShell';

export const dynamic = 'force-dynamic';

interface DebateRow {
  id: string;
  status: 'live' | 'completed' | 'scheduled';
  mux_playback_id: string | null;
  topic: string;
}

interface PageProps {
  params: Promise<{ debateId: string }>;
}

export default async function DebatePage({ params }: PageProps) {
  const { debateId } = await params;

  const result = await pool.query<DebateRow>(
    `SELECT id, status, mux_playback_id, topic
     FROM listening.debates
     WHERE id = $1
       AND status IN ('live', 'completed', 'scheduled')`,
    [debateId],
  );

  if (result.rows.length === 0) {
    notFound();
  }

  const debate = result.rows[0];

  return (
    <ObserverShell
      debateId={debate.id}
      initialStatus={debate.status}
      initialPlaybackId={debate.mux_playback_id}
      topic={debate.topic}
    />
  );
}
