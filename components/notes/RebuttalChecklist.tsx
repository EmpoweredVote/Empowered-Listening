'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNotesStore, type NoteRow } from '@/store/notesStore';

interface RebuttalChecklistProps {
  debateId: string;
  token: string;
}

/**
 * RebuttalChecklist — the speaker's prioritized list of points to answer.
 *
 * Items come from two places: notes the speaker typed and promoted, and
 * transcript lines they flagged with TranscriptSelectionPopup. Order is
 * dragged (mouse or keyboard) and persisted via the /reorder route.
 *
 * Checkbox state is deliberately EPHEMERAL — it lives in the store's
 * `checkedIds` and is never written to the database, so a reload clears it.
 * "Addressed" is a within-segment working state, not a fact about the debate.
 */
export function RebuttalChecklist({ debateId, token }: RebuttalChecklistProps) {
  const notes = useNotesStore((s) => s.notes);
  const checkedIds = useNotesStore((s) => s.checkedIds);
  const setChecked = useNotesStore((s) => s.setChecked);

  const [activeId, setActiveId] = useState<string | null>(null);

  const rebuttalNotes = useMemo(
    () =>
      notes
        .filter((n) => n.rebuttal_order !== null)
        .sort((a, b) => (a.rebuttal_order ?? 0) - (b.rebuttal_order ?? 0)),
    [notes],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rebuttalNotes.findIndex((n) => n.id === active.id);
    const newIndex = rebuttalNotes.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(rebuttalNotes, oldIndex, newIndex).map((n, i) => ({
      ...n,
      rebuttal_order: i,
    }));

    // Optimistic — the list re-sorts from the store immediately.
    const store = useNotesStore.getState();
    store.setNotes([...store.notes.filter((n) => n.rebuttal_order === null), ...reordered]);

    void fetch(`/api/debates/${debateId}/notes/${reordered[0].id}/reorder`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderedIds: reordered.map((n) => n.id) }),
    }).catch((err: unknown) => console.error('[RebuttalChecklist] reorder', err));
  }

  async function demoteNote(id: string) {
    const previous = useNotesStore.getState().notes.find((n) => n.id === id);
    useNotesStore.getState().updateNote(id, { rebuttal_order: null });

    try {
      const res = await fetch(`/api/debates/${debateId}/notes/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rebuttalOrder: null }),
      });
      if (!res.ok) throw new Error(`Demote failed (${res.status})`);
    } catch (err) {
      // Put it back where it was rather than leaving the UI lying.
      if (previous) {
        useNotesStore.getState().updateNote(id, { rebuttal_order: previous.rebuttal_order });
      }
      console.error('[RebuttalChecklist] demote', err);
    }
  }

  if (rebuttalNotes.length === 0) {
    return (
      <p className="px-1 py-2 text-xs italic text-slate-500">
        No rebuttal items yet. Promote a note, or select transcript text to add one.
      </p>
    );
  }

  const activeNote = activeId ? rebuttalNotes.find((n) => n.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={rebuttalNotes.map((n) => n.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-1.5" aria-label="Rebuttal checklist">
          {rebuttalNotes.map((note) => (
            <SortableRebuttalItem
              key={note.id}
              note={note}
              checked={!!checkedIds[note.id]}
              onToggle={() => setChecked(note.id, !checkedIds[note.id])}
              onDemote={() => void demoteNote(note.id)}
            />
          ))}
        </ul>
      </SortableContext>

      <DragOverlay>
        {activeNote ? <RebuttalItemBody note={activeNote} checked={!!checkedIds[activeNote.id]} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRebuttalItem({
  note,
  checked,
  onToggle,
  onDemote,
}: {
  note: NoteRow;
  checked: boolean;
  onToggle: () => void;
  onDemote: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-900 p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder: ${note.content.slice(0, 40)}`}
        className="mt-0.5 cursor-grab select-none text-slate-500 hover:text-slate-300 active:cursor-grabbing"
      >
        ⠿
      </button>

      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Mark as addressed: ${note.content.slice(0, 40)}`}
        className="mt-1 accent-amber-500"
      />

      <RebuttalItemBody note={note} checked={checked} />

      <button
        type="button"
        onClick={onDemote}
        aria-label="Remove from rebuttal list"
        className="mt-0.5 px-1 text-slate-500 hover:text-slate-200"
      >
        ×
      </button>
    </li>
  );
}

function RebuttalItemBody({
  note,
  checked,
  dragging = false,
}: {
  note: NoteRow;
  checked: boolean;
  dragging?: boolean;
}) {
  return (
    <div
      className={[
        'flex-1 text-sm text-slate-100',
        checked ? 'line-through opacity-60' : '',
        dragging ? 'rounded-md border border-amber-400/40 bg-slate-900 p-2 shadow-lg' : '',
      ].join(' ')}
    >
      {note.debate_time_mmss && (
        <span className="mr-1 font-mono text-xs text-slate-500">@{note.debate_time_mmss}</span>
      )}
      {note.source_transcript_entry_id && (
        <span
          title="From the transcript"
          aria-label="From the transcript"
          className="mr-1 text-xs text-amber-400"
        >
          ❝
        </span>
      )}
      <span className="whitespace-pre-wrap leading-relaxed">{note.content}</span>
      {note.is_edited && <span className="ml-1 text-xs italic text-slate-500">(edited)</span>}
    </div>
  );
}
