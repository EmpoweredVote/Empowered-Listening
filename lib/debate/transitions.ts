import 'server-only';
import { pool } from '@/lib/db/pool';

export interface SegmentRow {
  id: string; debate_id: string; segment_type: string; speaker_id: string | null;
  sequence_order: number; allocated_seconds: number; bonus_seconds_used: number;
  status: 'upcoming' | 'active' | 'completed' | 'paused';
  actual_start: string | null; actual_end: string | null;
  end_time: string | null; prep_time_end_time: string | null;
}

export async function startSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string; durationSeconds: number;
}): Promise<SegmentRow> {
  const { rows } = await pool.query<SegmentRow>(
    `SELECT * FROM listening.start_segment($1, $2, $3, $4)`,
    [args.debateId, args.segmentId, args.moderatorUserId, args.durationSeconds],
  );
  if (rows.length === 0) throw new Error('start_segment returned no rows');
  return rows[0];
}

export async function endSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string;
}): Promise<SegmentRow> {
  const { rows } = await pool.query<SegmentRow>(
    `SELECT * FROM listening.end_segment($1, $2, $3)`,
    [args.debateId, args.segmentId, args.moderatorUserId],
  );
  if (rows.length === 0) throw new Error('end_segment returned no rows');
  return rows[0];
}

export async function repeatSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string; durationSeconds: number;
}): Promise<SegmentRow> {
  const { rows } = await pool.query<SegmentRow>(
    `SELECT * FROM listening.repeat_segment($1, $2, $3, $4)`,
    [args.debateId, args.segmentId, args.moderatorUserId, args.durationSeconds],
  );
  if (rows.length === 0) throw new Error('repeat_segment returned no rows');
  return rows[0];
}

export async function startPrepTime(args: {
  debateId: string; segmentId: string; speakerId: string; callerUserId: string; prepSeconds: number;
}): Promise<{ segment: SegmentRow; prep_remaining: number }> {
  // RETURNS TABLE(segment listening.debate_segments, prep_remaining integer)
  // Expand the nested composite via (r.segment).* so pg returns flat columns.
  const { rows } = await pool.query<SegmentRow & { prep_remaining: number }>(
    `SELECT (r.segment).*, r.prep_remaining
     FROM listening.start_prep_time($1, $2, $3, $4, $5) r`,
    [args.debateId, args.segmentId, args.speakerId, args.callerUserId, args.prepSeconds],
  );
  if (rows.length === 0) throw new Error('start_prep_time returned no rows');
  const { prep_remaining, ...segment } = rows[0];
  return { segment: segment as SegmentRow, prep_remaining };
}

export async function endPrepTime(args: {
  debateId: string; segmentId: string; speakerId: string; callerUserId: string;
}): Promise<SegmentRow> {
  const { rows } = await pool.query<SegmentRow>(
    `SELECT * FROM listening.end_prep_time($1, $2, $3, $4)`,
    [args.debateId, args.segmentId, args.speakerId, args.callerUserId],
  );
  if (rows.length === 0) throw new Error('end_prep_time returned no rows');
  return rows[0];
}

export async function consumeBonusTime(args: { speakerId: string; seconds: number }): Promise<number> {
  const { rows } = await pool.query<{ consume_bonus_time: number }>(
    `SELECT listening.consume_bonus_time($1, $2)`,
    [args.speakerId, args.seconds],
  );
  return rows[0].consume_bonus_time;
}
