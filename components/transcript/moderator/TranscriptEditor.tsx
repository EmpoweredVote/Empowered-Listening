'use client';

import { useCallback, useRef, useState } from 'react';

export interface TranscriptEditorProps {
  entry: {
    id: string;
    debate_id: string;
    speaker_id: string;
    spoken_at: string;
    debate_time_mmss: string;
    text: string;
    original_text: string | null;
    edited: boolean;
    edited_at: string | null;
    edited_by: string | null;
  };
  speaker: { displayName: string; role: 'affirmative' | 'negative' | 'moderator' } | undefined;
  editorName: string;
}

const ROLE_COLORS: Record<'affirmative' | 'negative' | 'moderator', string> = {
  affirmative: 'text-blue-400',
  negative: 'text-amber-400',
  moderator: 'text-slate-400',
};

const ROLE_LABELS: Record<'affirmative' | 'negative' | 'moderator', string> = {
  affirmative: 'Aff',
  negative: 'Neg',
  moderator: 'Mod',
};

export function TranscriptEditor({ entry, speaker, editorName }: TranscriptEditorProps) {
  const [editing, setEditing] = useState(false);
  const [savedText, setSavedText] = useState(entry.text);
  const [draftText, setDraftText] = useState(entry.text);
  const [isEdited, setIsEdited] = useState(entry.edited);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const role = speaker?.role ?? 'moderator';
  const labelColor = ROLE_COLORS[role] ?? 'text-slate-400';
  const roleLabel = ROLE_LABELS[role] ?? 'Mod';
  const displayName = speaker?.displayName ?? 'Unknown';

  const startEditing = useCallback(() => {
    setDraftText(savedText);
    setEditing(true);
    setErrorState(null);
    // Focus textarea on next tick after render
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [savedText]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setDraftText(savedText);
    setErrorState(null);
  }, [savedText]);

  const saveEdit = useCallback(async (textToSave: string) => {
    if (textToSave === savedText) {
      setEditing(false);
      return;
    }
    if (!textToSave.trim()) {
      setErrorState('Text cannot be empty');
      return;
    }

    setIsSaving(true);
    // Optimistic update
    const previousText = savedText;
    const previousEdited = isEdited;
    setSavedText(textToSave);
    setIsEdited(true);
    setEditing(false);
    setErrorState(null);

    try {
      const res = await fetch(
        `/api/moderator/debates/${entry.debate_id}/transcript/${entry.id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Authorization header is set by SessionProvider via localStorage token
            Authorization: `Bearer ${localStorage.getItem('ev_token') ?? ''}`,
          },
          body: JSON.stringify({ text: textToSave }),
        },
      );

      if (!res.ok) {
        // Revert optimistic update on error
        setSavedText(previousText);
        setIsEdited(previousEdited);
        const data = await res.json().catch(() => ({}));
        setErrorState(data.error ?? `Save failed (${res.status})`);
      }
    } catch {
      // Network error — revert
      setSavedText(previousText);
      setIsEdited(previousEdited);
      setErrorState('Network error — changes not saved');
    } finally {
      setIsSaving(false);
    }
  }, [savedText, isEdited, entry.debate_id, entry.id]);

  const handleRevertToOriginal = useCallback(async () => {
    if (!entry.original_text) return;
    await saveEdit(entry.original_text);
  }, [entry.original_text, saveEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit(draftText);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    },
    [draftText, saveEdit, cancelEditing],
  );

  const handleBlur = useCallback(() => {
    // Small delay to allow Revert button click to register before blur fires
    setTimeout(() => {
      if (editing) {
        saveEdit(draftText);
      }
    }, 150);
  }, [editing, draftText, saveEdit]);

  return (
    <div
      className="group border-b border-slate-800 py-3 px-2 hover:bg-slate-900 cursor-pointer"
      onClick={!editing ? startEditing : undefined}
    >
      {/* Speaker label + timestamp */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium ${labelColor}`}>
          {displayName} · {roleLabel}
        </span>
        <span className="text-slate-500 text-xs font-mono">{entry.debate_time_mmss}</span>
      </div>

      {/* Body: editing textarea or display text */}
      {editing ? (
        <div className="mt-1" onClick={e => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            className="w-full bg-slate-800 text-slate-100 text-sm p-2 rounded border border-blue-500 focus:outline-none resize-none"
            rows={3}
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={isSaving}
          />
          <div className="flex items-center gap-3 mt-1">
            <span className="text-slate-500 text-xs">Enter to save · Esc to cancel</span>
            {entry.original_text && (
              <button
                className="text-xs text-slate-400 underline hover:text-slate-200 mt-1"
                onMouseDown={e => {
                  // Prevent blur from firing before click
                  e.preventDefault();
                }}
                onClick={e => {
                  e.stopPropagation();
                  handleRevertToOriginal();
                }}
              >
                Revert to original
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-slate-100 text-sm mt-1">{savedText}</p>
      )}

      {/* Error state */}
      {errorState && (
        <p className="text-red-400 text-xs mt-1">{errorState}</p>
      )}

      {/* Edited-by badge */}
      {isEdited && !editing && (
        <p className="text-slate-500 text-xs italic mt-1">Edited by {editorName}</p>
      )}
    </div>
  );
}
