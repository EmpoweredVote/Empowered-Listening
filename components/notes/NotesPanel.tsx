'use client';

import { useEffect, useState } from 'react';
import { useNotesStore } from '@/store/notesStore';
import { useUserRole } from '@/hooks/useUserRole';
import { NoteInput } from './NoteInput';
import { NoteItem } from './NoteItem';
import type { NoteRow } from '@/store/notesStore';

interface NotesPanelProps {
  debateId: string;
}

/**
 * NotesPanel — the full notes sidebar for both desktop and mobile layouts.
 *
 * - Header: "Notes" title + "+ Add note" button + "Export PDF" button
 * - Scrollable list sorted by created_at ASC
 * - Empty state message when no notes
 * - Sticky input region gated by auth tier
 * - Loads notes from API on mount (when token available)
 * - Listens for 'notes:focus-input' custom event → opens/focuses input
 * - Export PDF: fetches with bearer → blob → anchor click
 */
export function NotesPanel({ debateId }: NotesPanelProps) {
  const { token, tier, loading } = useUserRole();
  const notes = useNotesStore((s) => s.notes);
  const setNotes = useNotesStore((s) => s.setNotes);

  const [inputOpen, setInputOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Determine if the user can take notes
  const canTakeNotes = token && (tier === 'connected' || tier === 'empowered');
  const isAnonymous = !token && !loading;
  const isInformTier = token && tier === 'inform';

  // Load notes on mount when token is available
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    fetch(`/api/debates/${debateId}/notes`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ notes: NoteRow[] }>;
      })
      .then((data) => {
        if (!cancelled && data) {
          setNotes(data.notes);
        }
      })
      .catch(() => {
        // Non-fatal; notes panel remains empty
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, debateId]);

  // Listen for 'notes:focus-input' custom event
  useEffect(() => {
    function handleFocusInput() {
      if (canTakeNotes) {
        setInputOpen(true);
      }
    }
    window.addEventListener('notes:focus-input', handleFocusInput);
    return () => window.removeEventListener('notes:focus-input', handleFocusInput);
  }, [canTakeNotes]);

  async function handleExport() {
    if (!token) return;

    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/debates/${debateId}/notes/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setExportError('Export failed. Please try again.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debate-notes-${debateId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Network error during export.');
    } finally {
      setExporting(false);
    }
  }

  // Sort notes by created_at ASC (store may have them in any order after edits)
  const sortedNotes = [...notes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">Notes</h2>
        <div className="flex items-center gap-1">
          {canTakeNotes && (
            <button
              onClick={() => setInputOpen(true)}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
              aria-label="Add note"
            >
              + Add note
            </button>
          )}
          {/* Export PDF button */}
          {token ? (
            <button
              onClick={() => void handleExport()}
              disabled={exporting}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Export notes as PDF"
            >
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          ) : (
            <button
              disabled
              title="Sign in to export notes"
              className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-500 cursor-not-allowed"
              aria-label="Export notes as PDF (sign in required)"
            >
              Export PDF
            </button>
          )}
        </div>
      </div>

      {exportError && (
        <div className="shrink-0 px-3 py-1.5 bg-red-950 border-b border-red-800">
          <p className="text-xs text-red-400">{exportError}</p>
        </div>
      )}

      {/* Scrollable notes list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {sortedNotes.length === 0 ? (
          <p className="text-sm text-slate-500 mt-4 text-center">
            No notes yet.{canTakeNotes ? ' Press N or click + Add note to start.' : ''}
          </p>
        ) : (
          sortedNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              debateId={debateId}
              token={token!}
            />
          ))
        )}
      </div>

      {/* Sticky input region */}
      <div className="shrink-0">
        {isAnonymous && (
          <div className="px-3 py-3 border-t border-slate-800 text-sm text-slate-400 text-center">
            Sign in to take notes.
          </div>
        )}
        {isInformTier && (
          <div className="px-3 py-3 border-t border-slate-800 text-sm text-slate-400 text-center">
            Upgrade to Connected to take notes.
          </div>
        )}
        {canTakeNotes && inputOpen && (
          <NoteInput
            debateId={debateId}
            token={token!}
            initialFocus={inputOpen}
            onSaved={() => setInputOpen(false)}
          />
        )}
        {canTakeNotes && !inputOpen && (
          <div className="px-3 py-2 border-t border-slate-800">
            <button
              onClick={() => setInputOpen(true)}
              className="w-full text-left text-sm text-slate-500 hover:text-slate-300 py-1"
            >
              Click or press N to add a note…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
