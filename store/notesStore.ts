'use client';

import { create } from 'zustand';

/**
 * NoteRow — mirrors the API response shape exactly.
 * is_checked is intentionally absent: checked state is ephemeral and lives
 * in `checkedIds` on the store, never in the DB row.
 */
export interface NoteRow {
  id: string;
  debate_id: string;
  content: string;
  debate_time_mmss: string | null;
  created_at: string;
  updated_at: string | null;
  is_edited: boolean;
  rebuttal_order: number | null;
  source_transcript_entry_id: string | null;
}

export interface NotesStoreState {
  /** All of the user's notes for the active debate. */
  notes: NoteRow[];
  /**
   * Ephemeral, never persisted — tracks which notes the speaker has marked
   * as "addressed" during the rebuttal phase.
   */
  checkedIds: Record<string, boolean>;

  /** Replace the whole list (used after fetching from GET). */
  setNotes(notes: NoteRow[]): void;

  /** Append a new note (used after POST returns the created row). */
  addNote(note: NoteRow): void;

  /** Merge updates into an existing note by id. */
  updateNote(id: string, updates: Partial<NoteRow>): void;

  /**
   * Remove a note by id.
   * Also removes the id from checkedIds so stale checked state is cleaned up.
   */
  removeNote(id: string): void;

  /**
   * Reconstruct the notes array to match the given orderedIds order.
   * Notes present in orderedIds appear first (in that order); notes NOT in
   * orderedIds are appended at the end sorted by created_at ASC.
   * This supports the rebuttal checklist view where only a subset of notes
   * is in the reorder list.
   */
  reorderNotes(orderedIds: string[]): void;

  /** Set the checked (addressed) state for a single note. */
  setChecked(id: string, checked: boolean): void;

  /** Clear all checked state. */
  resetChecked(): void;

  /** Reset the store to its initial empty state. */
  reset(): void;
}

export const useNotesStore = create<NotesStoreState>((set, get) => ({
  notes: [],
  checkedIds: {},

  setNotes(notes) {
    set({ notes });
  },

  addNote(note) {
    set((state) => ({ notes: [...state.notes, note] }));
  },

  updateNote(id, updates) {
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    }));
  },

  removeNote(id) {
    set((state) => {
      const notes = state.notes.filter((n) => n.id !== id);
      const checkedIds = { ...state.checkedIds };
      delete checkedIds[id];
      return { notes, checkedIds };
    });
  },

  reorderNotes(orderedIds) {
    set((state) => {
      const orderedSet = new Set(orderedIds);
      const noteMap = new Map(state.notes.map((n) => [n.id, n]));

      // Notes in the orderedIds list, in the given order
      const ordered = orderedIds
        .map((id) => noteMap.get(id))
        .filter((n): n is NoteRow => n !== undefined);

      // Notes NOT in the orderedIds list, sorted by created_at ASC
      const unordered = state.notes
        .filter((n) => !orderedSet.has(n.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      return { notes: [...ordered, ...unordered] };
    });
  },

  setChecked(id, checked) {
    set((state) => ({
      checkedIds: { ...state.checkedIds, [id]: checked },
    }));
  },

  resetChecked() {
    set({ checkedIds: {} });
  },

  reset() {
    set({ notes: [], checkedIds: {} });
  },
}));
