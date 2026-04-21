export type LDSpeakerRole = 'affirmative' | 'negative' | 'both';

export type LDSegmentType =
  | 'affirmative_constructive'
  | 'cross_examination_by_neg'
  | 'negative_constructive'
  | 'cross_examination_by_aff'
  | 'affirmative_rebuttal_1'
  | 'negative_rebuttal'
  | 'affirmative_rebuttal_2';

export interface LDSegment {
  sequenceOrder: number;
  segmentType: LDSegmentType;
  displayName: string;
  abbreviation: string;
  activeSpeakerRole: LDSpeakerRole;
  allocatedSeconds: number;
}

export const LD_SEGMENTS: readonly LDSegment[] = [
  {
    sequenceOrder: 1,
    segmentType: 'affirmative_constructive',
    displayName: 'Affirmative Constructive',
    abbreviation: 'AC',
    activeSpeakerRole: 'affirmative',
    allocatedSeconds: 6 * 60,
  },
  {
    sequenceOrder: 2,
    segmentType: 'cross_examination_by_neg',
    displayName: 'Cross-Examination (Negative questions Affirmative)',
    abbreviation: 'CX',
    activeSpeakerRole: 'both',
    allocatedSeconds: 3 * 60,
  },
  {
    sequenceOrder: 3,
    segmentType: 'negative_constructive',
    displayName: 'Negative Constructive',
    abbreviation: 'NC',
    activeSpeakerRole: 'negative',
    allocatedSeconds: 7 * 60,
  },
  {
    sequenceOrder: 4,
    segmentType: 'cross_examination_by_aff',
    displayName: 'Cross-Examination (Affirmative questions Negative)',
    abbreviation: 'CX',
    activeSpeakerRole: 'both',
    allocatedSeconds: 3 * 60,
  },
  {
    sequenceOrder: 5,
    segmentType: 'affirmative_rebuttal_1',
    displayName: 'First Affirmative Rebuttal',
    abbreviation: '1AR',
    activeSpeakerRole: 'affirmative',
    allocatedSeconds: 4 * 60,
  },
  {
    sequenceOrder: 6,
    segmentType: 'negative_rebuttal',
    displayName: 'Negative Rebuttal',
    abbreviation: 'NR',
    activeSpeakerRole: 'negative',
    allocatedSeconds: 6 * 60,
  },
  {
    sequenceOrder: 7,
    segmentType: 'affirmative_rebuttal_2',
    displayName: 'Second Affirmative Rebuttal',
    abbreviation: '2AR',
    activeSpeakerRole: 'affirmative',
    allocatedSeconds: 3 * 60,
  },
] as const;

export const LD_TOTAL_SPEAKING_SECONDS = LD_SEGMENTS.reduce(
  (sum, s) => sum + s.allocatedSeconds,
  0,
);

export const LD_PREP_TIME_SECONDS = 4 * 60;

export const LD_BONUS_TIME_SECONDS = 60;

export function getSegmentBySequence(sequenceOrder: number): LDSegment {
  const s = LD_SEGMENTS[sequenceOrder - 1];
  if (!s || s.sequenceOrder !== sequenceOrder) {
    throw new Error(`Invalid LD sequence_order: ${sequenceOrder}`);
  }
  return s;
}
