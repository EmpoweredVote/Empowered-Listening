'use client';

import React, { useRef, useState } from 'react';
import { useDebateStore } from '@/store/debateStore';
import { useSegmentAutoExpire } from '@/hooks/useSegmentAutoExpire';
import { LD_SEGMENTS } from '@/lib/debate/segments';
import { SegmentTimer } from './SegmentTimer';
import { PrepTimeDisplay } from './PrepTimeDisplay';
import { BonusTimeDisplay } from './BonusTimeDisplay';

interface ModeratorPanelProps {
  debateId: string;
}

export function ModeratorPanel({ debateId }: ModeratorPanelProps) {
  // This panel drives auto-expire — only the moderator's tab should run it.
  useSegmentAutoExpire(debateId, true);

  // Track which speaker has an active prep session.
  // Cleared when prep ends (by either speaker clicking end, or the server resetting
  // segment status to 'active' via Realtime — we could sync from store.status but
  // local state is simpler since the moderator is the one driving).
  const [prepSpeakerId, setPrepSpeakerId] = useState<string | null>(null);
  // Blocks a second click while the end request is in flight.
  const [ending, setEnding] = useState(false);
  // Shared across both PrepButtons — prevents concurrent prep API calls (double-click / both buttons).
  const prepBusyRef = useRef(false);

  const segments = useDebateStore(s => s.segments);
  const speakers = useDebateStore(s => s.speakers);
  const active = useDebateStore(s => s.getActiveSegment());
  const activeStatus = active?.status;

  // If the server resets the segment status away from 'paused' (e.g., via repeat
  // or end_segment), clear prepSpeakerId — prep is no longer active.
  if (prepSpeakerId && activeStatus !== 'paused') {
    // Use a setTimeout 0 for safety.
    setTimeout(() => setPrepSpeakerId(null), 0);
  }

  const allSegments = Object.values(segments).sort((a, b) => a.sequence_order - b.sequence_order);
  const nextUpcoming = allSegments.find(s => s.status === 'upcoming');
  const affSpeaker = Object.values(speakers).find(s => s.role === 'affirmative');
  const negSpeaker = Object.values(speakers).find(s => s.role === 'negative');

  async function call(path: string, body: unknown) {
    const token = localStorage.getItem('ev_token');
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) alert(`Error: ${await res.text()}`);
    return res;
  }

  async function endDebate(outcome: 'completed' | 'cancelled') {
    const verb = outcome === 'completed' ? 'finish' : 'cancel';
    if (!window.confirm(
      `This will ${verb} the debate and shut down the video stream, recording and transcription. Continue?`,
    )) return;
    setEnding(true);
    try {
      const res = await call(`/api/debates/${debateId}/end`, { outcome });
      if (res.ok) alert('Debate ended. Video stream and transcription released.');
    } finally {
      setEnding(false);
    }
  }

  const activeMeta = active ? LD_SEGMENTS.find(m => m.segmentType === active.segment_type) : null;
  const upcomingMeta = nextUpcoming ? LD_SEGMENTS.find(m => m.segmentType === nextUpcoming.segment_type) : null;
  const displayMeta = activeMeta ?? upcomingMeta;

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-ev-muted-blue">Moderator controls</h2>
        <p className="text-sm text-slate-600">
          {displayMeta
            ? `Segment ${displayMeta.sequenceOrder}/7 — ${displayMeta.displayName}`
            : 'Debate complete'}
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <SegmentTimer className="text-3xl" />
        <PrepTimeDisplay />
        <BonusTimeDisplay debateId={debateId} />
      </div>

      <div className="flex flex-wrap gap-2">
        {active && (
          <>
            <button
              onClick={() => call(`/api/debates/${debateId}/segments/${active.id}`, { action: 'end' })}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">End segment</button>
            <button
              onClick={() => call(`/api/debates/${debateId}/segments/${active.id}`, { action: 'repeat' })}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white">Repeat segment</button>
          </>
        )}
        {nextUpcoming && !active && (
          <button
            onClick={() => call(`/api/debates/${debateId}/segments/${nextUpcoming.id}`, { action: 'start' })}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">
            Start segment {nextUpcoming.sequence_order}/7
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-700">Prep time</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {affSpeaker && (
            <PrepButton
              debateId={debateId}
              speaker={affSpeaker}
              segmentActive={!!active}
              prepSpeakerId={prepSpeakerId}
              prepBusyRef={prepBusyRef}
              onPrepStart={() => setPrepSpeakerId(affSpeaker.id)}
              onPrepEnd={() => setPrepSpeakerId(null)}
            />
          )}
          {negSpeaker && (
            <PrepButton
              debateId={debateId}
              speaker={negSpeaker}
              segmentActive={!!active}
              prepSpeakerId={prepSpeakerId}
              prepBusyRef={prepBusyRef}
              onPrepStart={() => setPrepSpeakerId(negSpeaker.id)}
              onPrepEnd={() => setPrepSpeakerId(null)}
            />
          )}
        </div>
      </div>

      {/* Ending a debate is what releases the LiveKit egress, the Mux stream
          and the transcription worker. Closing the tab does not, which is how
          one egress ran for six hours against an empty room. Kept in its own
          section, away from "End segment", because the two are a bad pair to
          confuse. */}
      <div className="mt-4 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-700">End debate</h3>
        <p className="mt-1 text-xs text-slate-500">
          Shuts down the video stream, recording and transcription. Closing this tab does not.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => endDebate('completed')}
            disabled={ending}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            Finish debate
          </button>
          <button
            onClick={() => endDebate('cancelled')}
            disabled={ending}
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            Cancel debate
          </button>
        </div>
      </div>
    </aside>
  );
}

interface PrepButtonProps {
  debateId: string;
  speaker: { id: string; display_name: string; prep_time_seconds: number };
  segmentActive: boolean;
  prepSpeakerId: string | null;
  prepBusyRef: React.RefObject<boolean>;
  onPrepStart: () => void;
  onPrepEnd: () => void;
}

function PrepButton({
  debateId, speaker, segmentActive, prepSpeakerId, prepBusyRef, onPrepStart, onPrepEnd,
}: PrepButtonProps) {
  const isThisSpeakersPrep = prepSpeakerId === speaker.id;
  const isAnyPrepActive = prepSpeakerId !== null;
  const action: 'start' | 'end' = isThisSpeakersPrep ? 'end' : 'start';

  async function go() {
    // Shared ref blocks concurrent calls from double-click or pressing both buttons.
    if (prepBusyRef.current) return;
    prepBusyRef.current = true;
    // Optimistic update — immediately disables the other button before fetch returns.
    if (action === 'start') onPrepStart();
    else onPrepEnd();

    const token = localStorage.getItem('ev_token');
    const res = await fetch(`/api/debates/${debateId}/prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, speakerId: speaker.id }),
    });
    if (!res.ok) {
      // Revert optimistic update on failure.
      if (action === 'start') onPrepEnd();
      else onPrepStart();
      alert(`Prep action failed: ${await res.text().catch(() => res.statusText)}`);
    }
    prepBusyRef.current = false;
  }

  const disabled =
    !segmentActive ||
    (action === 'start' && speaker.prep_time_seconds <= 0) ||
    (action === 'start' && isAnyPrepActive);

  return (
    <button
      onClick={go}
      disabled={disabled}
      className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">
      {action === 'start' ? 'Start' : 'End'} prep — {speaker.display_name} ({speaker.prep_time_seconds}s pool)
    </button>
  );
}
