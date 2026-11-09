import { notFound } from 'next/navigation';
import { pool } from '@/lib/db/pool';
import {
  DEBATE_VIDEO_COLUMNS,
  resolveDebateVideo,
  type DebateVideoRow,
} from '@/lib/debates/recording';
import ObserverShell from './ObserverShell';

export const dynamic = 'force-dynamic';

interface DebateRow extends DebateVideoRow {
  topic: string;
}

interface PageProps {
  params: Promise<{ debateId: string }>;
}

export default async function DebatePage({ params }: PageProps) {
  const { debateId } = await params;

  const result = await pool.query<DebateRow>(
    `SELECT ${DEBATE_VIDEO_COLUMNS}, topic
     FROM listening.debates
     WHERE id = $1
       AND status IN ('live', 'completed', 'scheduled')`,
    [debateId],
  );

  if (result.rows.length === 0) {
    notFound();
  }

  const debate = result.rows[0];
  const video = await resolveDebateVideo(debate);

  return (
    <ObserverShell
      debateId={debate.id}
      initialStatus={debate.status}
      initialPlaybackId={video.playbackId}
      initialRecordingPending={video.recordingPending}
      topic={debate.topic}
    />
  );
}
