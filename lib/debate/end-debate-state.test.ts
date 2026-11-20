import { describe, it, expect } from 'vitest';
import {
  END_DEBATE_IDLE,
  endDebateView,
  endFailed,
  endSucceeded,
  isSettled,
  pressEnd,
  type EndDebateState,
} from './end-debate-state';

describe('end-debate state — the triple click (#95)', () => {
  it('is the fix: a successful end does not put the button back', () => {
    // The old code cleared its busy flag in a `finally`, so the control
    // returned to looking exactly as it had before it was pressed. That is
    // what the moderator read as "nothing happened", three times.
    const ending = pressEnd(END_DEBATE_IDLE, 'live', 'completed');
    const ended = endSucceeded(ending);

    expect(endDebateView(ended, 'live').disabled).toBe(true);
    expect(endDebateView(ended, 'live').status).toEqual({
      tone: 'done',
      message: 'Debate ended. Video stream, recording and transcription released.',
    });
  });

  it('drops a second press while the first is in flight', () => {
    const ending = pressEnd(END_DEBATE_IDLE, 'live', 'completed');
    // Identity, not equality: the caller uses this to decide whether to fire
    // the request at all, rather than trusting a disabled attribute to have
    // been applied already.
    expect(pressEnd(ending, 'live', 'completed')).toBe(ending);
    expect(pressEnd(ending, 'live', 'cancelled')).toBe(ending);
  });

  it('drops a press once the debate has ended', () => {
    const ended = endSucceeded(pressEnd(END_DEBATE_IDLE, 'live', 'completed'));
    expect(pressEnd(ended, 'live', 'cancelled')).toBe(ended);
  });

  it('accepts the first press on a live debate', () => {
    const next = pressEnd(END_DEBATE_IDLE, 'live', 'completed');
    expect(next).toEqual({ phase: 'ending', outcome: 'completed' });
  });
});

describe('end-debate state — in flight', () => {
  it('names only the control that was pressed', () => {
    const view = endDebateView(pressEnd(END_DEBATE_IDLE, 'live', 'cancelled'), 'live');
    expect(view.cancelLabel).toBe('Cancelling…');
    expect(view.finishLabel).toBe('Finish debate');
    expect(view.disabled).toBe(true);
  });

  it('says what is being released, since that is the slow part', () => {
    const view = endDebateView(pressEnd(END_DEBATE_IDLE, 'live', 'completed'), 'live');
    expect(view.status?.tone).toBe('pending');
    expect(view.status?.message).toMatch(/video stream, recording and transcription/i);
  });
});

describe('end-debate state — failure', () => {
  const failed = endFailed(pressEnd(END_DEBATE_IDLE, 'live', 'completed'), 'egress stop failed');

  it('re-enables the controls, because the debate is still running', () => {
    expect(endDebateView(failed, 'live').disabled).toBe(false);
  });

  it('says the debate is still running, not just that something errored', () => {
    const view = endDebateView(failed, 'live');
    expect(view.status?.tone).toBe('error');
    expect(view.status?.message).toContain('still running');
    expect(view.status?.message).toContain('egress stop failed');
  });

  it('falls back to a message rather than showing an empty reason', () => {
    const blank = endFailed(pressEnd(END_DEBATE_IDLE, 'live', 'completed'), '   ');
    expect(endDebateView(blank, 'live').status?.message).toContain('Unknown error');
  });

  it('ignores a resolution that does not belong to a request in flight', () => {
    expect(endSucceeded(END_DEBATE_IDLE)).toBe(END_DEBATE_IDLE);
    expect(endFailed(END_DEBATE_IDLE, 'boom')).toBe(END_DEBATE_IDLE);
    expect(endSucceeded(failed)).toBe(failed);
  });
});

describe('end-debate state — the debate ended some other way', () => {
  it('reports a completed debate as over even from idle', () => {
    // The last segment ending runs teardown server-side, so the debate can
    // finish without this button being touched.
    const view = endDebateView(END_DEBATE_IDLE, 'completed');
    expect(view.disabled).toBe(true);
    expect(view.status?.tone).toBe('done');
  });

  it('distinguishes a cancelled debate from a finished one', () => {
    expect(endDebateView(END_DEBATE_IDLE, 'cancelled').status?.message).toContain('cancelled');
    expect(endDebateView(END_DEBATE_IDLE, 'completed').status?.message).toContain('Debate ended');
  });

  it('refuses a press on a debate that is already over', () => {
    expect(pressEnd(END_DEBATE_IDLE, 'completed', 'cancelled')).toBe(END_DEBATE_IDLE);
    expect(isSettled(END_DEBATE_IDLE, 'cancelled')).toBe(true);
  });

  it('leaves a scheduled or live debate pressable', () => {
    expect(isSettled(END_DEBATE_IDLE, 'scheduled')).toBe(false);
    expect(isSettled(END_DEBATE_IDLE, 'live')).toBe(false);
    // The snapshot may not have arrived yet; that is not a reason to block.
    expect(isSettled(END_DEBATE_IDLE, undefined)).toBe(false);
  });

  it('keeps a failure visible even though the store still says live', () => {
    const failed: EndDebateState = endFailed(
      pressEnd(END_DEBATE_IDLE, 'live', 'completed'),
      'mux complete failed',
    );
    expect(endDebateView(failed, 'live').status?.tone).toBe('error');
  });
});
