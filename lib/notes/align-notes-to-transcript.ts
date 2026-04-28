/**
 * Pure alignment function: maps each note to the nearest-earlier transcript entry.
 * No side effects. No DOM. No database. No @react-pdf/renderer.
 */

export interface AlignedNote {
  id: string;
  content: string;
  debate_time_mmss: string | null;
  is_edited: boolean;
  /**
   * Index in the transcript array (sorted ASC by time) of the nearest-earlier
   * transcript entry.  -1 means no earlier entry exists — note should render
   * at the top of the page, before any transcript content.
   */
  alignedTranscriptIndex: number;
}

export interface TranscriptForAlignment {
  id: string;
  debate_time_mmss: string;
}

export interface NoteForAlignment {
  id: string;
  content: string;
  debate_time_mmss: string | null;
  is_edited: boolean;
}

/**
 * Convert a "M:SS", "MM:SS", or "MMM:SS" timestamp to total seconds.
 * Returns NaN if the format is invalid.
 */
function mmssToSeconds(mmss: string): number {
  const colonIdx = mmss.lastIndexOf(':');
  if (colonIdx === -1) return NaN;
  const minutesPart = mmss.slice(0, colonIdx);
  const secondsPart = mmss.slice(colonIdx + 1);
  const minutes = parseInt(minutesPart, 10);
  const seconds = parseInt(secondsPart, 10);
  if (isNaN(minutes) || isNaN(seconds)) return NaN;
  return minutes * 60 + seconds;
}

/**
 * Align notes to the nearest-earlier transcript entry.
 *
 * Algorithm:
 * 1. Sort a copy of transcript ASC by debate_time_mmss seconds.
 * 2. For each note (preserving input order):
 *    - If debate_time_mmss is null → alignedTranscriptIndex = -1.
 *    - Otherwise find the highest transcript index where
 *      transcript[i].seconds <= note.seconds.  If none → -1.
 * 3. Return new AlignedNote[] preserving the original input order.
 *
 * Inputs are NOT mutated.
 */
export function alignNotesToTranscript(
  notes: NoteForAlignment[],
  transcript: TranscriptForAlignment[],
): AlignedNote[] {
  // Build a sorted copy of transcript entries with their seconds value,
  // retaining the original index so we can look up positions after sorting.
  const sortedTranscript = transcript
    .map((entry, originalIndex) => ({
      entry,
      originalIndex,
      seconds: mmssToSeconds(entry.debate_time_mmss),
    }))
    .filter((t) => !isNaN(t.seconds))
    .sort((a, b) => a.seconds - b.seconds);

  return notes.map((note): AlignedNote => {
    if (note.debate_time_mmss === null) {
      return { ...note, alignedTranscriptIndex: -1 };
    }

    const noteSeconds = mmssToSeconds(note.debate_time_mmss);
    if (isNaN(noteSeconds)) {
      return { ...note, alignedTranscriptIndex: -1 };
    }

    // Binary-search for the rightmost entry with seconds <= noteSeconds.
    let lo = 0;
    let hi = sortedTranscript.length - 1;
    let bestSortedIdx = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedTranscript[mid].seconds <= noteSeconds) {
        bestSortedIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (bestSortedIdx === -1) {
      return { ...note, alignedTranscriptIndex: -1 };
    }

    return { ...note, alignedTranscriptIndex: sortedTranscript[bestSortedIdx].originalIndex };
  });
}
