'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotesStore, type NoteRow } from '@/store/notesStore';

interface TranscriptSelectionPopupProps {
  debateId: string;
  token: string;
  /** The transcript panel's scroll container — selections outside it are ignored. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface PopupState {
  text: string;
  /** Viewport coordinates — the popup is position:fixed. */
  top: number;
  left: number;
  /**
   * The transcript entry the selection started in, or null when that entry has
   * no database id yet. Entries that arrive over the broadcast channel are given
   * a synthetic `${speakerId}-${spokenAt}` id by TranscriptPanel, which is not a
   * UUID and would be rejected by the POST body schema and the
   * notes.source_transcript_entry_id foreign key. A null here still creates the
   * note — it just carries no link back to the line.
   */
  anchorEntryId: string | null;
}

const POPUP_OFFSET_PX = 38;

/**
 * TranscriptSelectionPopup — speaker-only "+ Rebuttal" affordance.
 *
 * Mounted only when the viewer is a debate speaker. Selecting text inside the
 * transcript panel raises a small floating button; clicking it files the
 * selection as a rebuttal note anchored to the line it came from.
 */
export function TranscriptSelectionPopup({
  debateId,
  token,
  containerRef,
}: TranscriptSelectionPopupProps) {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [saving, setSaving] = useState(false);
  const popupRef = useRef<HTMLButtonElement>(null);

  // --- Raise the popup on a selection inside the transcript container ---
  useEffect(() => {
    function handleMouseUp() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPopup(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setPopup(null);
        return;
      }

      const container = containerRef.current;
      const anchorNode = selection.anchorNode;
      if (!container || !anchorNode || !container.contains(anchorNode)) {
        setPopup(null);
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPopup(null);
        return;
      }

      // Walk up from the selection to the entry element that carries a real id.
      const startEl =
        anchorNode.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode.parentElement;
      const entryEl = startEl?.closest('[data-transcript-entry-id]') ?? null;
      const anchorEntryId = entryEl?.getAttribute('data-transcript-entry-id') || null;

      setPopup({
        text,
        top: rect.top - POPUP_OFFSET_PX,
        left: rect.left + rect.width / 2,
        anchorEntryId,
      });
    }

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [containerRef]);

  // --- Dismiss on an outside press, or when the panel scrolls away ---
  useEffect(() => {
    if (!popup) return;

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && popupRef.current?.contains(target)) return;
      setPopup(null);
    }

    // position:fixed would leave the button stranded once the text moves.
    function dismiss() {
      setPopup(null);
    }

    document.addEventListener('mousedown', handleMouseDown);
    containerRef.current?.addEventListener('scroll', dismiss);
    window.addEventListener('resize', dismiss);

    const container = containerRef.current;
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      container?.removeEventListener('scroll', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [popup, containerRef]);

  const handleAdd = useCallback(async () => {
    if (!popup || saving) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/debates/${debateId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: popup.text.slice(0, 2000),
          debateTimeMmss: null,
          sourceTranscriptEntryId: popup.anchorEntryId,
          addToRebuttal: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`Add to rebuttal failed (${res.status})`);
      }

      const { note } = (await res.json()) as { note: NoteRow };
      useNotesStore.getState().addNote(note);
      window.getSelection()?.removeAllRanges();
      setPopup(null);
    } catch (err) {
      console.error('[TranscriptSelectionPopup]', err);
      setPopup(null);
    } finally {
      setSaving(false);
    }
  }, [popup, saving, debateId, token]);

  if (!popup) return null;

  return (
    <button
      ref={popupRef}
      type="button"
      onClick={handleAdd}
      disabled={saving}
      aria-label="Add selection to rebuttal list"
      style={{ top: popup.top, left: popup.left, transform: 'translateX(-50%)' }}
      className="fixed z-50 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-amber-300 shadow-lg ring-1 ring-amber-400/40 transition-colors hover:bg-slate-800 disabled:opacity-60"
    >
      {saving ? 'Adding…' : '+ Rebuttal'}
    </button>
  );
}
