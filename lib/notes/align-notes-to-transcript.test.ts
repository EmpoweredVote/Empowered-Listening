/// <reference types="vitest/globals" />
import { alignNotesToTranscript } from './align-notes-to-transcript';
import type { NoteForAlignment, TranscriptForAlignment } from './align-notes-to-transcript';

// Helpers
function makeNote(
  id: string,
  debate_time_mmss: string | null,
  content = 'test note',
): NoteForAlignment {
  return { id, content, debate_time_mmss, is_edited: false };
}

function makeEntry(id: string, debate_time_mmss: string): TranscriptForAlignment {
  return { id, debate_time_mmss };
}

describe('alignNotesToTranscript', () => {
  // Case 1: Empty inputs → returns []
  it('returns [] when both notes and transcript are empty', () => {
    expect(alignNotesToTranscript([], [])).toEqual([]);
  });

  // Case 2: Empty transcript with notes → every note has alignedTranscriptIndex = -1
  it('assigns alignedTranscriptIndex -1 to all notes when transcript is empty', () => {
    const notes = [makeNote('n1', '1:00'), makeNote('n2', '2:30'), makeNote('n3', null)];
    const result = alignNotesToTranscript(notes, []);
    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r.alignedTranscriptIndex).toBe(-1));
  });

  // Case 3: Note exactly at a transcript entry's time → aligns to that entry's index
  it('aligns note exactly at a transcript entry time to that entry index', () => {
    const transcript = [makeEntry('e0', '1:00'), makeEntry('e1', '2:00'), makeEntry('e2', '3:00')];
    const notes = [makeNote('n1', '2:00')];
    const result = alignNotesToTranscript(notes, transcript);
    // transcript[1] is the '2:00' entry (original index 1)
    expect(result[0].alignedTranscriptIndex).toBe(1);
  });

  // Case 4: Note between two entries → aligns to the nearest-earlier one
  it('aligns note between entries to the nearest-earlier entry', () => {
    // Transcript at 2:50, 3:10, 3:30
    const transcript = [
      makeEntry('e0', '2:50'),
      makeEntry('e1', '3:10'),
      makeEntry('e2', '3:30'),
    ];
    const notes = [makeNote('n1', '3:15')]; // between 3:10 and 3:30
    const result = alignNotesToTranscript(notes, transcript);
    // Nearest earlier is transcript[1] ('3:10'), original index 1
    expect(result[0].alignedTranscriptIndex).toBe(1);
  });

  // Case 5: Note before the first transcript entry → alignedTranscriptIndex = -1
  it('assigns alignedTranscriptIndex -1 when note precedes all transcript entries', () => {
    const transcript = [makeEntry('e0', '1:00'), makeEntry('e1', '2:00')];
    const notes = [makeNote('n1', '0:30')];
    const result = alignNotesToTranscript(notes, transcript);
    expect(result[0].alignedTranscriptIndex).toBe(-1);
  });

  // Case 6: Notes with null debate_time_mmss → alignedTranscriptIndex = -1
  it('assigns alignedTranscriptIndex -1 for notes with null debate_time_mmss', () => {
    const transcript = [makeEntry('e0', '1:00'), makeEntry('e1', '2:00')];
    const notes = [makeNote('n1', null), makeNote('n2', null)];
    const result = alignNotesToTranscript(notes, transcript);
    result.forEach((r) => expect(r.alignedTranscriptIndex).toBe(-1));
  });

  // Case 7: Output preserves input note order
  it('preserves input note order in output', () => {
    const transcript = [makeEntry('e0', '1:00'), makeEntry('e1', '3:00'), makeEntry('e2', '5:00')];
    const notes = [
      makeNote('n3', '4:00'),
      makeNote('n1', '0:30'),
      makeNote('n2', '2:00'),
    ];
    const result = alignNotesToTranscript(notes, transcript);
    expect(result.map((r) => r.id)).toEqual(['n3', 'n1', 'n2']);
    // n3 at 4:00 → nearest earlier is e1 (3:00, index 1)
    expect(result[0].alignedTranscriptIndex).toBe(1);
    // n1 at 0:30 → before all → -1
    expect(result[1].alignedTranscriptIndex).toBe(-1);
    // n2 at 2:00 → nearest earlier is e0 (1:00, index 0)
    expect(result[2].alignedTranscriptIndex).toBe(0);
  });

  // Bonus: does not mutate inputs
  it('does not mutate the input arrays', () => {
    const transcript = [makeEntry('e0', '1:00'), makeEntry('e1', '3:00')];
    const notes = [makeNote('n1', '2:00')];
    const transcriptCopy = JSON.parse(JSON.stringify(transcript));
    const notesCopy = JSON.parse(JSON.stringify(notes));
    alignNotesToTranscript(notes, transcript);
    expect(notes).toEqual(notesCopy);
    expect(transcript).toEqual(transcriptCopy);
  });
});
