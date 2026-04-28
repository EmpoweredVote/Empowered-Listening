'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useNotesStore } from '@/store/notesStore';
import { useDebateStore } from '@/store/debateStore';
import { computeDebateTimeMmss } from '@/lib/transcription/debate-time';

interface NoteInputProps {
  debateId: string;
  token: string;
  /** When true, the textarea receives focus on mount. */
  initialFocus?: boolean;
  /** Called after a note is successfully saved. */
  onSaved?: () => void;
}

/**
 * Sticky note input bar for the NotesPanel.
 *
 * - Enter (no Shift) → save note
 * - Shift+Enter → native newline
 * - Auto-grows from 2 rows up to 6 rows
 * - Shows inline error on save failure (auto-clears after 3s)
 * - Disabled while save is in flight
 */
export function NoteInput({ debateId, token, initialFocus, onSaved }: NoteInputProps) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addNote = useNotesStore((s) => s.addNote);

  function showError(msg: string, clearInput = false) {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setError(msg);
    if (clearInput) setValue('');
    errorTimerRef.current = setTimeout(() => setError(null), 3000);
  }

  async function save() {
    const content = value.trim();
    if (!content) return;

    // Compute debate_time_mmss from active segment
    let debateTimeMmss: string | null = null;
    const activeSegment = useDebateStore.getState().getActiveSegment();
    if (activeSegment?.actual_start) {
      try {
        debateTimeMmss = computeDebateTimeMmss(
          new Date(activeSegment.actual_start),
          new Date(),
        );
      } catch {
        // Non-fatal; proceed without timestamp
      }
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/debates/${debateId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          debateTimeMmss,
          sourceTranscriptEntryId: null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { error?: string }).error ?? `Save failed (${res.status})`;
        // On 5xx: keep textarea content; on 4xx: also keep (user may want to edit)
        showError(msg, false);
        return;
      }

      const data = await res.json() as { note: import('@/store/notesStore').NoteRow };
      addNote(data.note);
      setValue('');
      onSaved?.();
    } catch {
      showError('Network error — note not saved.', false);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
    // Shift+Enter falls through to default — browser inserts a newline
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-t border-slate-800 bg-slate-950">
      <textarea
        ref={(el) => {
          (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
          if (initialFocus && el) el.focus();
        }}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={saving}
        placeholder="Type a note and press Enter to save…"
        aria-label="Note input"
        className={[
          'w-full resize-none rounded bg-slate-800 px-3 py-2',
          'text-sm text-slate-100 placeholder-slate-500',
          'border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'min-h-[3rem] max-h-[9rem]',
        ].join(' ')}
        style={{ fieldSizing: 'content' } as React.CSSProperties}
      />
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500 select-none">
        Enter to save &middot; Shift+Enter for new line
      </p>
    </div>
  );
}
