import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DesktopGate } from '@/components/desktop-gate/DesktopGate';
import { getPool } from '@/lib/db/pool';
import { SpeakerJoinClient } from './SpeakerJoinClient';

export default async function SpeakerJoinPage(props: {
  params: Promise<{ debateId: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { debateId } = await props.params;
  const { s: speakerId } = await props.searchParams;
  const h = await headers();
  const joinUrl = `https://listening.empowered.vote/join/speaker/${debateId}${speakerId ? `?s=${speakerId}` : ''}`;

  if (h.get('x-mobile-gate') === '1') {
    return <DesktopGate joinUrl={joinUrl} />;
  }
  if (!speakerId) notFound();

  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    role: 'affirmative' | 'negative' | 'moderator';
    display_name: string;
    livekit_identity: string;
  }>(
    `SELECT id, role, display_name, livekit_identity
     FROM listening.debate_speakers
     WHERE debate_id = $1
     ORDER BY role`,
    [debateId],
  );
  if (rows.length !== 3) notFound();

  const speakers = rows.map(r => ({
    id: r.id,
    role: r.role,
    displayName: r.display_name,
    livekitIdentity: r.livekit_identity,
  }));

  return (
    <SpeakerJoinClient
      debateId={debateId}
      speakerId={speakerId}
      speakers={speakers}
    />
  );
}
