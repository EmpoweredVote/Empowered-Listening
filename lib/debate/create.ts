import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import { LD_SEGMENTS } from '@/lib/debate/segments';

export interface CreateDebateInput {
  topic: string;
  moderatorUserId: string;
  moderatorDisplayName: string;
  affirmativeName: string;
  negativeName: string;
  scheduledStart?: Date;
}

export interface CreateDebateResult {
  debateId: string;
  roomName: string;
  affirmativeSpeakerId: string;
  negativeSpeakerId: string;
  moderatorSpeakerId: string;
}

export async function createDebate(input: CreateDebateInput): Promise<CreateDebateResult> {
  const debateId = randomUUID();
  const roomName = `ld-${debateId}`;
  const start = input.scheduledStart ?? new Date();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO listening.debates
         (id, title, topic, format, pillar, scheduled_start, status, livekit_room_name, created_by)
       VALUES ($1, $2, $3, 'lincoln_douglas', 'connect', $4, 'scheduled', $5, $6)`,
      [debateId, input.topic, input.topic, start, roomName, input.moderatorUserId],
    );

    const affId = randomUUID();
    const negId = randomUUID();
    const modId = randomUUID();

    await client.query(
      `INSERT INTO listening.debate_speakers (id, debate_id, user_id, role, display_name, livekit_identity)
       VALUES
         ($1, $2, NULL,  'affirmative', $3, $4),
         ($5, $2, NULL,  'negative',    $6, $7),
         ($8, $2, $9,    'moderator',   $10, $11)`,
      [
        affId, debateId, input.affirmativeName, `${debateId}:aff:${affId}`,
        negId,           input.negativeName,    `${debateId}:neg:${negId}`,
        modId,           input.moderatorUserId,  input.moderatorDisplayName, `${debateId}:mod:${modId}`,
      ],
    );

    for (const seg of LD_SEGMENTS) {
      const speakerId =
        seg.activeSpeakerRole === 'affirmative' ? affId
        : seg.activeSpeakerRole === 'negative' ? negId
        : null;

      await client.query(
        `INSERT INTO listening.debate_segments
           (debate_id, segment_type, speaker_id, sequence_order, allocated_seconds, status)
         VALUES ($1, $2, $3, $4, $5, 'upcoming')`,
        [debateId, seg.segmentType, speakerId, seg.sequenceOrder, seg.allocatedSeconds],
      );
    }

    await client.query('COMMIT');
    return { debateId, roomName, affirmativeSpeakerId: affId, negativeSpeakerId: negId, moderatorSpeakerId: modId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
