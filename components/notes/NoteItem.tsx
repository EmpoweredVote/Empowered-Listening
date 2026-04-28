'use client';

import { useState, useRef, type KeyboardEvent } from 'react';
import { useNotesStore } from '@/store/notesStore';
import type { NoteRow } from '@/store/notesStore';

interface NoteItemProps {
  note: NoteRow;
  debateId: string;
  token: string;
}

/**
 * A single note card in the NotesPanel.
 *
 * Display: timestamp badge, (edited) indicator, content (whitespace-pre-wrap).
 * Hover/focus: Edit + Delete buttons revealed.
 * Edit: inline textarea with Save/Cancel; PUT on save.
 * Delete: window.confirm then DELETE → removeNote(id).
 * Styling: dark slate (bg-slate-900, border-slate-800, text-slate-100).
 */
export function NoteItem({ note, debateId, token }: NoteItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const updateNote = useNotesStore((s) => s.updateNote);
  const removeNote = useNotesStore((s) => s.removeNote);

  function startEdit() {
    setEditValue(note.content);
    setEditing(true);
    setError(null);
    // Focus textarea after render
    setTimeout(() => editRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function saveEdit() {
    const content = editValue.trim();
    if (!content) {
      setError('Note cannot be empty.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/debates/${debateId}/notes/${note.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `Save failed (${res.status})`);
        return;
      }

      const data = await res.json() as { note: NoteRow };
      updateNote(note.id, data.note);
      setEditing(false);
    } catch {
      setError('Network error — changes not saved.');
    } finally {
      setSaving(false);
    }
  }

  function handleEditKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this note?')) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/debates/${debateId}/notes/${note.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok && res.status !== 204) {
        // 204 has no body; anything else is an error
        return;
      }

      removeNote(note.id);
    } catch {
      // Silent fail — note remains in UI
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="group relative rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Timestamp + edited indicator */}
      <div className="flex items-center gap-2 mb-1 text-xs text-slate-400">
        {note.debate_time_mmss && (
          <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
            @ {note.debate_time_mmss}
          </span>
        )}
        {note.is_edited && (
          <span className="text-slate-500 italic">(edited)</span>
        )}
      </div>

      {/* Content — view or edit mode */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={editRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            disabled={saving}
            rows={3}
            className={[
              'w-full resize-none rounded bg-slate-800 px-2 py-1.5',
              'text-sm text-slate-100 border border-slate-700',
              'focus:outline-none focus:ring-1 focus:ring-blue-500',
              'disabled:opacity-50',
            ].join(' ')}
          />
          {error && (
            <p className="text-xs text-red-400" role="alert">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void saveEdit()}
              disabled={saving}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-slate-100 leading-relaxed">
          {note.content}
        </p>
      )}

      {/* Edit + Delete buttons — shown on hover (or focus-within) when not in edit mode */}
      {!editing && (hovered || deleting) && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={startEdit}
            aria-label="Edit note"
            className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
          >
            Edit
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            aria-label="Delete note"
            className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-red-400 hover:bg-red-900 hover:text-red-200 disabled:opacity-50"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
