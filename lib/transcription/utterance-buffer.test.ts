import { describe, it, expect } from 'vitest';
import {
  UtteranceBuffer,
  CONFIDENCE_FLOOR,
  MAX_UTTERANCE_MS,
  type FinalChunk,
} from './utterance-buffer';

const T0 = new Date('2026-11-18T22:00:00.000Z');

/** A committed chunk `offsetMs` after T0. */
function chunk(
  text: string,
  offsetMs: number,
  overrides: Partial<FinalChunk> = {},
): FinalChunk {
  return {
    text,
    confidence: 0.9,
    speechFinal: false,
    receivedAt: new Date(T0.getTime() + offsetMs),
    ...overrides,
  };
}

describe('UtteranceBuffer', () => {
  it('holds committed chunks until a speech boundary arrives', () => {
    const buffer = new UtteranceBuffer();

    expect(buffer.add(chunk('since', 0))).toBeNull();
    expect(buffer.add(chunk("you're", 400))).toBeNull();
    expect(buffer.add(chunk('home', 800))).toBeNull();

    const utterance = buffer.add(chunk('you can add', 1200, { speechFinal: true }));
    expect(utterance?.text).toBe("since you're home you can add");
  });

  it('is the fix for the one-word-per-row transcript', () => {
    // The real shape of the Jackson sitting on 2026-11-18: Deepgram committed
    // a word or two at a time, and every one became its own row with its own
    // speaker heading. These same chunks must now produce one row.
    const buffer = new UtteranceBuffer();
    const words = ['now', 'i', 'me', 'alright', 'so'];

    const rows = words
      .map((word, i) => buffer.add(chunk(word, i * 900)))
      .filter((u) => u !== null);
    expect(rows).toHaveLength(0);

    expect(buffer.flush()?.text).toBe('now i me alright so');
  });

  it('starts a fresh utterance after releasing one', () => {
    const buffer = new UtteranceBuffer();

    buffer.add(chunk('first', 0));
    expect(buffer.add(chunk('thought', 500, { speechFinal: true }))?.text).toBe('first thought');

    expect(buffer.hasPending).toBe(false);
    buffer.add(chunk('second', 2000));
    expect(buffer.flush()?.text).toBe('second');
  });

  it('stamps the utterance with when the speaker started, not when they stopped', () => {
    // This becomes `spoken_at` and `debate_time_mmss`, which is what a quoted
    // note anchors to. The flush time would put every quote at the end of the
    // sentence it quotes.
    const buffer = new UtteranceBuffer();

    buffer.add(chunk('the', 0));
    buffer.add(chunk('whole', 3000));
    const utterance = buffer.add(chunk('sentence', 6000, { speechFinal: true }));

    expect(utterance?.startedAt).toEqual(T0);
  });

  it('reports the lowest chunk confidence, not an average', () => {
    const buffer = new UtteranceBuffer();

    buffer.add(chunk('clear', 0, { confidence: 0.99 }));
    buffer.add(chunk('garbled', 500, { confidence: 0.33 }));
    const utterance = buffer.add(chunk('again', 1000, { confidence: 0.97, speechFinal: true }));

    expect(utterance?.confidence).toBe(0.33);
  });

  describe('noise', () => {
    it('drops chunks below the confidence floor', () => {
      const buffer = new UtteranceBuffer();

      buffer.add(chunk('real', 0));
      buffer.add(chunk('breath', 300, { confidence: CONFIDENCE_FLOOR - 0.01 }));
      buffer.add(chunk('words', 600));

      expect(buffer.flush()?.text).toBe('real words');
    });

    it('keeps a chunk exactly at the floor', () => {
      const buffer = new UtteranceBuffer();
      buffer.add(chunk('borderline', 0, { confidence: CONFIDENCE_FLOOR }));
      expect(buffer.flush()?.text).toBe('borderline');
    });

    it('drops empty and whitespace-only chunks', () => {
      const buffer = new UtteranceBuffer();

      buffer.add(chunk('kept', 0));
      buffer.add(chunk('', 100));
      buffer.add(chunk('   ', 200));

      expect(buffer.flush()?.text).toBe('kept');
    });

    it('trims each chunk so joining never doubles a space', () => {
      const buffer = new UtteranceBuffer();

      buffer.add(chunk(' padded ', 0));
      buffer.add(chunk('  text  ', 100));

      expect(buffer.flush()?.text).toBe('padded text');
    });

    it('releases nothing when every chunk was noise', () => {
      const buffer = new UtteranceBuffer();

      const released = buffer.add(chunk('hiss', 0, { confidence: 0.01, speechFinal: true }));

      expect(released).toBeNull();
      expect(buffer.hasPending).toBe(false);
    });

    it('still closes the utterance when the boundary chunk itself is noise', () => {
      // The chunk carrying `speech_final` can be the one that fails the floor.
      // Dropping its text must not also swallow the words already buffered.
      const buffer = new UtteranceBuffer();

      buffer.add(chunk('real words', 0));
      const utterance = buffer.add(chunk('hiss', 500, { confidence: 0.01, speechFinal: true }));

      expect(utterance?.text).toBe('real words');
    });
  });

  describe('the safety release', () => {
    it('releases a speaker who never pauses', () => {
      const buffer = new UtteranceBuffer();

      expect(buffer.add(chunk('still', 0))).toBeNull();
      expect(buffer.add(chunk('going', MAX_UTTERANCE_MS - 1))).toBeNull();

      const utterance = buffer.add(chunk('and going', MAX_UTTERANCE_MS));
      expect(utterance?.text).toBe('still going and going');
    });

    it('measures from the first chunk of the current utterance, not the stream', () => {
      const buffer = new UtteranceBuffer();

      buffer.add(chunk('first', 0, { speechFinal: true }));
      // Well past MAX_UTTERANCE_MS on the stream clock, but this utterance is
      // one chunk old.
      expect(buffer.add(chunk('second', MAX_UTTERANCE_MS * 3))).toBeNull();
    });

    it('is configurable', () => {
      const buffer = new UtteranceBuffer(1000);

      buffer.add(chunk('a', 0));
      expect(buffer.add(chunk('b', 1000))?.text).toBe('a b');
    });
  });

  describe('flush', () => {
    it('returns null when nothing is buffered', () => {
      expect(new UtteranceBuffer().flush()).toBeNull();
    });

    it('is idempotent', () => {
      const buffer = new UtteranceBuffer();
      buffer.add(chunk('once', 0));

      expect(buffer.flush()?.text).toBe('once');
      expect(buffer.flush()).toBeNull();
    });
  });

  it('tracks whether a flush would produce anything', () => {
    const buffer = new UtteranceBuffer();

    expect(buffer.hasPending).toBe(false);
    buffer.add(chunk('pending', 0));
    expect(buffer.hasPending).toBe(true);
    buffer.add(chunk('done', 100, { speechFinal: true }));
    expect(buffer.hasPending).toBe(false);
  });
});
