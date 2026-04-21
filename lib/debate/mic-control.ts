import 'server-only';
import { getPool } from '@/lib/db/pool';
import { setMicPermission } from '@/lib/livekit/room-service';
import { LD_SEGMENTS, type LDSegmentType } from '@/lib/debate/segments';

/**
 * Reads the segment + all three speakers from the DB, then issues setMicPermission calls
 * so the LiveKit room reflects the segment's active-speaker rule:
 *
 *   affirmative_constructive / affirmative_rebuttal_1 / affirmative_rebuttal_2
 *     -> affirmative.canPublish = true, negative.canPublish = false
 *   negative_constructive / negative_rebuttal
 *     -> negative.canPublish = true, affirmative.canPublish = false
 *   cross_examination_by_neg / cross_examination_by_aff
 *     -> both speakers canPublish = true
 *
 * Moderator always canPublish = false (per mintToken grant).  We do not touch moderator permissions.
 */
export async function applySegmentMicPermissions(debateId: string, segmentId: string): Promise<void> {
  const pool = getPool();
  const { rows: segRows } = await pool.query<{ segment_type: LDSegmentType }>(
    `SELECT segment_type FROM listening.debate_segments WHERE id = $1 AND debate_id = $2`,
    [segmentId, debateId],
  );
  if (segRows.length === 0) throw new Error('Segment not found');
  const segmentType = segRows[0].segment_type;

  const { rows: speakerRows } = await pool.query<{
    role: 'affirmative' | 'negative' | 'moderator';
    livekit_identity: string;
  }>(
    `SELECT role, livekit_identity FROM listening.debate_speakers WHERE debate_id = $1`,
    [debateId],
  );
  const { rows: debateRows } = await pool.query<{ livekit_room_name: string }>(
    `SELECT livekit_room_name FROM listening.debates WHERE id = $1`,
    [debateId],
  );
  if (debateRows.length === 0) throw new Error('Debate not found');
  const roomName = debateRows[0].livekit_room_name;

  const aff = speakerRows.find(r => r.role === 'affirmative');
  const neg = speakerRows.find(r => r.role === 'negative');
  if (!aff || !neg) throw new Error('Missing affirmative or negative speaker row');

  const meta = LD_SEGMENTS.find(s => s.segmentType === segmentType);
  if (!meta) throw new Error(`Unknown segment_type: ${segmentType}`);

  // Decide publish rights
  let affPub: boolean, negPub: boolean;
  if (meta.activeSpeakerRole === 'both') { affPub = true; negPub = true; }
  else if (meta.activeSpeakerRole === 'affirmative') { affPub = true; negPub = false; }
  else { affPub = false; negPub = true; }  // 'negative'

  // Apply — DB first was already done (caller of this helper runs this after RPC commit).
  // If one of these throws, log and continue so at least one side flips.  The DB is the source of truth;
  // a client reconnect re-mints tokens that encode the correct grants, so drift self-heals.
  await Promise.allSettled([
    setMicPermission(roomName, aff.livekit_identity, affPub),
    setMicPermission(roomName, neg.livekit_identity, negPub),
  ]);
}

/**
 * Called when a speaker's allocated_seconds + bonus_seconds are fully consumed.
 * Forces canPublish=false on that speaker so their mic stops publishing.
 */
export async function handleBonusExhaustion(debateId: string, speakerId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ livekit_identity: string; livekit_room_name: string }>(
    `SELECT ds.livekit_identity, d.livekit_room_name
     FROM listening.debate_speakers ds
     JOIN listening.debates d ON d.id = ds.debate_id
     WHERE ds.id = $1 AND ds.debate_id = $2`,
    [speakerId, debateId],
  );
  if (rows.length === 0) return;
  await setMicPermission(rows[0].livekit_room_name, rows[0].livekit_identity, false);
}
