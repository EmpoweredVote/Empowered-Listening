/**
 * Groups Deepgram's committed chunks into whole utterances.
 *
 * Deepgram's `is_final` does not mean "the speaker finished a thought" — it
 * means "this window is committed and will not be revised." On continuous
 * speech with the default 10ms endpointing it fires every word or two, so
 * writing a `transcript_entries` row per `is_final` produced a transcript of
 * one-word rows: `now` / `now` / `i` / `me` / `alright` / `so`. Every surface
 * that renders an entry with a speaker heading — the live panel, the moderator
 * review page, the exported PDF — then showed one heading per word, which is
 * unreadable. 04-RESEARCH.md picked `is_final` per chunk deliberately and named
 * this exact risk ("very fragmented entries"); the risk landed.
 *
 * `speech_final` is the endpointing signal — Deepgram detected a pause — and it
 * is the real utterance boundary. This buffer accumulates committed chunks and
 * releases them as one row when that boundary arrives.
 *
 * Nothing here rewrites words. The debate transcript is a verbatim civic
 * record, which is why `punctuate` and `smart_format` stay off and
 * `filler_words` stays on; grouping only decides where one row ends and the
 * next begins, and the words inside are joined exactly as Deepgram sent them.
 */

/**
 * Chunks below this confidence are dropped rather than written.
 *
 * Deepgram emits near-zero-confidence results for breaths, keyboard noise and
 * room tone. Carried over unchanged from the per-chunk implementation.
 */
export const CONFIDENCE_FLOOR = 0.1;

/**
 * Release an utterance after this long even without a `speech_final`.
 *
 * `speech_final` depends on endpointing finding a pause. A speaker who does not
 * pause — or a noisy room that keeps the detector from firing — would otherwise
 * buffer indefinitely and lose the whole stretch if the socket then dropped.
 * Fifteen seconds is a long sentence but still a readable paragraph, so the
 * failure mode is an over-long row rather than a lost one.
 */
export const MAX_UTTERANCE_MS = 15_000;

/** One committed (`is_final`) Deepgram result. */
export interface FinalChunk {
  text: string;
  confidence: number;
  /** Deepgram's `speech_final` — endpointing detected a pause. */
  speechFinal: boolean;
  receivedAt: Date;
}

/** A complete utterance, ready to become one `transcript_entries` row. */
export interface Utterance {
  text: string;
  confidence: number;
  /**
   * When the speaker *started* this utterance, not when they stopped.
   *
   * This becomes the row's `spoken_at` and its `debate_time_mmss`, which is
   * what a quoted note anchors to. Stamping the flush time instead would push
   * every quote marker to the end of the sentence it quotes.
   */
  startedAt: Date;
}

export class UtteranceBuffer {
  private chunks: FinalChunk[] = [];

  constructor(
    private readonly maxUtteranceMs: number = MAX_UTTERANCE_MS,
    private readonly confidenceFloor: number = CONFIDENCE_FLOOR,
  ) {}

  /**
   * Take one committed chunk. Returns an utterance when this chunk closed one,
   * otherwise null.
   */
  add(chunk: FinalChunk): Utterance | null {
    const text = chunk.text.trim();
    if (text && chunk.confidence >= this.confidenceFloor) {
      this.chunks.push({ ...chunk, text });
    }

    // A dropped chunk can still carry the boundary, but there is nothing to
    // close if no chunk has survived the floor yet.
    if (this.chunks.length === 0) return null;

    if (chunk.speechFinal) return this.flush();

    const elapsed = chunk.receivedAt.getTime() - this.chunks[0].receivedAt.getTime();
    if (elapsed >= this.maxUtteranceMs) return this.flush();

    return null;
  }

  /**
   * Release whatever is buffered. Call this before closing or reconnecting the
   * socket, so a part-finished sentence is written rather than dropped.
   */
  flush(): Utterance | null {
    if (this.chunks.length === 0) return null;

    const chunks = this.chunks;
    this.chunks = [];

    return {
      text: chunks.map((c) => c.text).join(' '),
      // The lowest chunk confidence, not an average: a row is only as
      // trustworthy as its least certain words, and averaging would let a run
      // of confident filler hide a garbled clause in the middle.
      confidence: Math.min(...chunks.map((c) => c.confidence)),
      startedAt: chunks[0].receivedAt,
    };
  }

  /** True when a flush would produce an utterance. */
  get hasPending(): boolean {
    return this.chunks.length > 0;
  }
}
