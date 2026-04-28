// Server-only: do NOT add 'use client' — imported by the route handler.
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import {
  alignNotesToTranscript,
  type NoteForAlignment,
  type TranscriptForAlignment,
} from '@/lib/notes/align-notes-to-transcript';

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

export interface DebateNotesPdfProps {
  debate: {
    title: string;
    date: string;
    moderatorName: string;
    affirmativeName: string;
    negativeName: string;
  };
  exporterName: string;
  notes: NoteForAlignment[];
  transcript: Array<
    TranscriptForAlignment & {
      speakerLabel: 'Aff' | 'Neg' | 'Mod';
      speakerName: string;
      text: string;
    }
  >;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    size: 'A4',
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 40,
    paddingRight: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#222222',
  },

  // ---- Header ----
  header: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
    borderBottomStyle: 'solid',
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: '#666666',
  },

  // ---- Body columns ----
  body: {
    flexDirection: 'row',
    flexGrow: 1,
  },

  // Transcript column (left, flex 2)
  transcriptColumn: {
    flex: 2,
    paddingRight: 12,
  },
  entryWrapper: {
    marginBottom: 6,
  },
  speakerLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#666666',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  entryText: {
    fontSize: 10,
    color: '#222222',
  },
  emptyTranscript: {
    fontSize: 9,
    color: '#666666',
    fontFamily: 'Helvetica-Oblique',
  },

  // Notes column (right, flex 1)
  notesColumn: {
    flex: 1,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#dddddd',
    borderLeftStyle: 'solid',
  },
  noteWrapper: {
    marginBottom: 8,
  },
  noteTimestamp: {
    fontSize: 7,
    color: '#666666',
    marginBottom: 2,
  },
  noteContent: {
    fontSize: 9,
    fontFamily: 'Helvetica-Oblique',
    color: '#222222',
  },
  noteEdited: {
    fontSize: 7,
    color: '#666666',
  },
  emptyNotes: {
    fontSize: 9,
    color: '#666666',
    fontFamily: 'Helvetica-Oblique',
  },
});

// ---------------------------------------------------------------------------
// Helper: render a single note row
// ---------------------------------------------------------------------------

function NoteItem({ note }: { note: NoteForAlignment }) {
  return (
    <View style={styles.noteWrapper}>
      {note.debate_time_mmss !== null && (
        <Text style={styles.noteTimestamp}>@ {note.debate_time_mmss}</Text>
      )}
      <Text style={styles.noteContent}>
        {note.content}
        {note.is_edited ? ' ' : ''}
      </Text>
      {note.is_edited && <Text style={styles.noteEdited}>(edited)</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DebateNotesPdf({
  debate,
  exporterName,
  notes,
  transcript,
}: DebateNotesPdfProps) {
  const hasTranscript = transcript.length > 0;
  const hasNotes = notes.length > 0;

  // Align notes to transcript entries
  const aligned = alignNotesToTranscript(notes, transcript);

  // Notes that precede the first transcript entry (or have null timestamp)
  const preNotes = aligned.filter((n) => n.alignedTranscriptIndex === -1);

  // Group remaining notes by their aligned transcript index
  const notesByTranscriptIdx = new Map<number, typeof aligned>();
  for (const note of aligned) {
    if (note.alignedTranscriptIndex === -1) continue;
    const existing = notesByTranscriptIdx.get(note.alignedTranscriptIndex) ?? [];
    existing.push(note);
    notesByTranscriptIdx.set(note.alignedTranscriptIndex, existing);
  }

  // When transcript is empty, show notes sorted by debate_time_mmss
  const flatNotesSorted = !hasTranscript
    ? [...notes].sort((a, b) => {
        if (a.debate_time_mmss === null && b.debate_time_mmss === null) return 0;
        if (a.debate_time_mmss === null) return -1;
        if (b.debate_time_mmss === null) return 1;
        return a.debate_time_mmss.localeCompare(b.debate_time_mmss);
      })
    : [];

  // Metadata row: date · Aff · Neg · Moderator · Exported by
  const metaLine = [
    debate.date,
    `Aff: ${debate.affirmativeName}`,
    `Neg: ${debate.negativeName}`,
    `Mod: ${debate.moderatorName}`,
    `Exported by: ${exporterName}`,
  ].join('  ·  ');

  return (
    <Document>
      <Page style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{debate.title}</Text>
          <Text style={styles.meta}>{metaLine}</Text>
        </View>

        {/* Body */}
        <View style={styles.body}>
          {/* Transcript column */}
          <View style={styles.transcriptColumn}>
            {!hasTranscript ? (
              <Text style={styles.emptyTranscript}>Transcript not yet available.</Text>
            ) : (
              transcript.map((entry, idx) => (
                <View key={entry.id} style={styles.entryWrapper}>
                  <Text style={styles.speakerLabel}>
                    {entry.speakerLabel} — {entry.speakerName}
                  </Text>
                  <Text style={styles.entryText}>{entry.text}</Text>
                </View>
              ))
            )}
          </View>

          {/* Notes column */}
          <View style={styles.notesColumn}>
            {!hasNotes ? (
              <Text style={styles.emptyNotes}>No notes for this debate.</Text>
            ) : !hasTranscript ? (
              // Flat sorted list when no transcript
              flatNotesSorted.map((note) => <NoteItem key={note.id} note={note} />)
            ) : (
              <>
                {/* Pre-transcript notes first */}
                {preNotes.map((note) => (
                  <NoteItem key={note.id} note={note} />
                ))}
                {/* Then notes grouped by transcript entry order */}
                {transcript.map((_, idx) => {
                  const group = notesByTranscriptIdx.get(idx);
                  if (!group || group.length === 0) return null;
                  return group.map((note) => <NoteItem key={note.id} note={note} />);
                })}
              </>
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
}
