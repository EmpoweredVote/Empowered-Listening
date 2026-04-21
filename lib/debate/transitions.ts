import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.schema('listening').rpc(fn, args);
  if (error) throw new Error(`listening.${fn} failed: ${error.message}`);
  return data as T;
}

export interface SegmentRow {
  id: string; debate_id: string; segment_type: string; speaker_id: string | null;
  sequence_order: number; allocated_seconds: number; bonus_seconds_used: number;
  status: 'upcoming' | 'active' | 'completed' | 'paused';
  actual_start: string | null; actual_end: string | null;
  end_time: string | null; prep_time_end_time: string | null;
}

export function startSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string; durationSeconds: number;
}): Promise<SegmentRow> {
  return callRpc<SegmentRow>('start_segment', {
    p_debate_id: args.debateId, p_segment_id: args.segmentId,
    p_moderator_user_id: args.moderatorUserId, p_duration_seconds: args.durationSeconds,
  });
}

export function endSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string;
}): Promise<SegmentRow> {
  return callRpc<SegmentRow>('end_segment', {
    p_debate_id: args.debateId, p_segment_id: args.segmentId,
    p_moderator_user_id: args.moderatorUserId,
  });
}

export function repeatSegment(args: {
  debateId: string; segmentId: string; moderatorUserId: string; durationSeconds: number;
}): Promise<SegmentRow> {
  return callRpc<SegmentRow>('repeat_segment', {
    p_debate_id: args.debateId, p_segment_id: args.segmentId,
    p_moderator_user_id: args.moderatorUserId, p_duration_seconds: args.durationSeconds,
  });
}

export function startPrepTime(args: {
  debateId: string; segmentId: string; speakerId: string; callerUserId: string; prepSeconds: number;
}): Promise<{ segment: SegmentRow; prep_remaining: number }> {
  return callRpc('start_prep_time', {
    p_debate_id: args.debateId, p_segment_id: args.segmentId, p_speaker_id: args.speakerId,
    p_caller_user_id: args.callerUserId, p_prep_seconds: args.prepSeconds,
  });
}

export function endPrepTime(args: {
  debateId: string; segmentId: string; speakerId: string; callerUserId: string;
}): Promise<SegmentRow> {
  return callRpc<SegmentRow>('end_prep_time', {
    p_debate_id: args.debateId, p_segment_id: args.segmentId, p_speaker_id: args.speakerId,
    p_caller_user_id: args.callerUserId,
  });
}

export function consumeBonusTime(args: { speakerId: string; seconds: number }): Promise<number> {
  return callRpc<number>('consume_bonus_time', {
    p_speaker_id: args.speakerId, p_seconds: args.seconds,
  });
}
