'use client';

import { create } from 'zustand';
import type { LDSegmentType } from '@/lib/debate/segments';

export interface DebateSegmentRow {
  id: string;
  debate_id: string;
  segment_type: LDSegmentType;
  speaker_id: string | null;  // null for CX (both speakers)
  sequence_order: number;
  allocated_seconds: number;
  bonus_seconds_used: number;
  actual_start: string | null;
  actual_end: string | null;
  status: 'upcoming' | 'active' | 'completed' | 'paused';
  end_time: string | null;                   // from 02-01 migration
  prep_time_end_time: string | null;         // from 02-01 migration
  paused_remaining_seconds: number | null;   // from 02-01 migration
}

export interface DebateSpeakerRow {
  id: string;
  debate_id: string;
  user_id: string | null;
  role: 'affirmative' | 'negative' | 'moderator' | 'panelist';
  display_name: string;
  bonus_time_seconds: number;
  prep_time_seconds: number;
  livekit_identity: string;
}

export interface DebateRow {
  id: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  livekit_room_name: string | null;
}

interface DebateStoreState {
  debate: DebateRow | null;
  segments: Record<string, DebateSegmentRow>;   // keyed by segment id
  speakers: Record<string, DebateSpeakerRow>;   // keyed by speaker id
  snapshotError: string | null;                 // surface-able error from snapshot fetch

  // Derived getters (as plain fns — call with useDebateStore.getState())
  getActiveSegment(): DebateSegmentRow | null;
  getSegmentBySequenceOrder(n: number): DebateSegmentRow | null;
  computeRemainingMs(): number;          // main segment timer remaining; 0 when none active or paused
  computePrepRemainingMs(): number;      // prep timer remaining; 0 when not in prep mode

  // Realtime sync actions
  setInitialSnapshot(args: { debate: DebateRow; segments: DebateSegmentRow[]; speakers: DebateSpeakerRow[] }): void;
  setSnapshotError(message: string | null): void;
  applyDebateUpdate(row: DebateRow): void;
  applySegmentUpdate(row: DebateSegmentRow): void;
  applySpeakerUpdate(row: DebateSpeakerRow): void;
  reset(): void;
}

export const useDebateStore = create<DebateStoreState>((set, get) => ({
  debate: null,
  segments: {},
  speakers: {},
  snapshotError: null,

  getActiveSegment() {
    const segs = Object.values(get().segments);
    return segs.find(s => s.status === 'active' || s.status === 'paused') ?? null;
  },
  getSegmentBySequenceOrder(n) {
    return Object.values(get().segments).find(s => s.sequence_order === n) ?? null;
  },
  computeRemainingMs() {
    const active = get().getActiveSegment();
    if (!active || !active.end_time || active.status !== 'active') return 0;
    return Math.max(0, new Date(active.end_time).getTime() - Date.now());
  },
  computePrepRemainingMs() {
    const active = get().getActiveSegment();
    if (!active || !active.prep_time_end_time || active.status !== 'paused') return 0;
    return Math.max(0, new Date(active.prep_time_end_time).getTime() - Date.now());
  },

  setInitialSnapshot({ debate, segments, speakers }) {
    set({
      debate,
      segments: Object.fromEntries(segments.map(s => [s.id, s])),
      speakers: Object.fromEntries(speakers.map(s => [s.id, s])),
      snapshotError: null,  // clear on successful load
    });
  },
  setSnapshotError(message) {
    set({ snapshotError: message });
  },
  applyDebateUpdate(row) {
    set({ debate: row });
  },
  applySegmentUpdate(row) {
    set(state => ({ segments: { ...state.segments, [row.id]: row } }));
  },
  applySpeakerUpdate(row) {
    set(state => ({ speakers: { ...state.speakers, [row.id]: row } }));
  },
  reset() {
    set({ debate: null, segments: {}, speakers: {}, snapshotError: null });
  },
}));
