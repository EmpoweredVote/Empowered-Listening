/**
 * What the End-debate controls show, and when they are pressable.
 *
 * Kept pure and free of React so it can be unit-tested — the same split as
 * `lib/debate/teardown-rules.ts` and `lib/transcription/utterance-buffer.ts`.
 *
 * The behaviour this encodes comes from a walkthrough on 2026-11-18, where the
 * moderator pressed End Debate and, seeing nothing change, pressed it twice
 * more:
 *
 *   19:50:41  POST /api/debates/db5b2241-.../end  200
 *   19:50:53  POST /api/debates/db5b2241-.../end  200
 *   19:50:58  POST /api/debates/db5b2241-.../end  200
 *
 * The route is idempotent, so nothing broke. But `/end` is the path that calls
 * `teardownDebateMedia` — it releases the LiveKit egress, the Mux stream and
 * the transcription worker — and a moderator who believes it did not work has
 * two bad options: keep clicking, or walk away from a debate they think is
 * still running and still billing (issue #95).
 *
 * Two rules do the work:
 *
 *   1. A press is only accepted from `idle`. Once a request is in flight, or
 *      the debate is over, further presses are dropped here rather than left
 *      to a disabled attribute the browser may or may not have applied yet.
 *   2. **Success is terminal.** The old code cleared its busy flag in a
 *      `finally`, so a successful end put the button straight back to looking
 *      exactly as it had before it was pressed — which is the thing the
 *      moderator read as "nothing happened".
 *
 * A failure is not terminal: it re-enables the controls and says why, because
 * a teardown that did not happen is a debate still holding an egress open.
 */

/** How a debate was ended. Mirrors `listening.debates.status`. */
export type EndOutcome = 'completed' | 'cancelled';

/** The debate's own status, as the store holds it. */
export type DebateStatus = 'scheduled' | 'live' | 'completed' | 'cancelled';

export type EndDebateState =
  | { phase: 'idle' }
  | { phase: 'ending'; outcome: EndOutcome }
  | { phase: 'ended'; outcome: EndOutcome }
  | { phase: 'failed'; outcome: EndOutcome; message: string };

export const END_DEBATE_IDLE: EndDebateState = { phase: 'idle' };

/** Is a request already in flight, or the debate already finished? */
export function isSettled(state: EndDebateState, status: DebateStatus | undefined): boolean {
  if (state.phase === 'ending' || state.phase === 'ended') return true;
  // The debate can also end by a path that is not this button: the last
  // segment ending runs teardown on the server. The controls must reflect
  // that too, or they invite a press that can only be a no-op.
  return status === 'completed' || status === 'cancelled';
}

/**
 * Accept a press, or refuse it.
 *
 * Returns the unchanged state when the press should be ignored, so a caller
 * can compare by identity to decide whether to issue the request.
 */
export function pressEnd(
  state: EndDebateState,
  status: DebateStatus | undefined,
  outcome: EndOutcome,
): EndDebateState {
  if (isSettled(state, status)) return state;
  return { phase: 'ending', outcome };
}

/** The request returned OK. Terminal — the controls do not come back. */
export function endSucceeded(state: EndDebateState): EndDebateState {
  if (state.phase !== 'ending') return state;
  return { phase: 'ended', outcome: state.outcome };
}

/** The request failed. The controls come back, with the reason attached. */
export function endFailed(state: EndDebateState, message: string): EndDebateState {
  if (state.phase !== 'ending') return state;
  return { phase: 'failed', outcome: state.outcome, message: message.trim() || 'Unknown error' };
}

export interface EndDebateView {
  /** Both controls disabled. */
  disabled: boolean;
  finishLabel: string;
  cancelLabel: string;
  /** The line rendered under the controls, or null when there is nothing to say. */
  status: { tone: 'pending' | 'done' | 'error'; message: string } | null;
}

/**
 * Everything the panel needs to render, derived from the state and the
 * debate's own status.
 *
 * `status` is what the moderator is actually waiting to see confirmed, so a
 * debate that reads `completed` or `cancelled` in the store reports as ended
 * regardless of which tab or which path ended it.
 */
export function endDebateView(
  state: EndDebateState,
  status: DebateStatus | undefined,
): EndDebateView {
  const serverSaysOver = status === 'completed' || status === 'cancelled';

  if (state.phase === 'ending') {
    return {
      disabled: true,
      finishLabel: state.outcome === 'completed' ? 'Ending…' : 'Finish debate',
      cancelLabel: state.outcome === 'cancelled' ? 'Cancelling…' : 'Cancel debate',
      status: {
        tone: 'pending',
        message: 'Releasing the video stream, recording and transcription…',
      },
    };
  }

  if (state.phase === 'ended' || serverSaysOver) {
    const outcome = state.phase === 'ended' ? state.outcome : status;
    return {
      disabled: true,
      finishLabel: 'Finish debate',
      cancelLabel: 'Cancel debate',
      status: {
        tone: 'done',
        message:
          outcome === 'cancelled'
            ? 'Debate cancelled. Video stream, recording and transcription released.'
            : 'Debate ended. Video stream, recording and transcription released.',
      },
    };
  }

  if (state.phase === 'failed') {
    return {
      disabled: false,
      finishLabel: 'Finish debate',
      cancelLabel: 'Cancel debate',
      status: {
        tone: 'error',
        // Named as unfinished business rather than a bare error: an egress is
        // still running and still billing until this succeeds.
        message: `Could not end the debate — it is still running. ${state.message}`,
      },
    };
  }

  return {
    disabled: false,
    finishLabel: 'Finish debate',
    cancelLabel: 'Cancel debate',
    status: null,
  };
}
