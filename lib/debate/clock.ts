/**
 * A clock the whole debate agrees on.
 *
 * Segment deadlines (`end_time`, `prep_time_end_time`) are written by Postgres,
 * but every countdown was rendered as `deadline - Date.now()` — the browser's
 * own clock. A machine whose clock is wrong therefore shows a wrong timer, and
 * nothing anywhere notices. In one sitting the moderator saw 6:13 while a
 * speaker saw 2:16 of the same segment.
 *
 * That is a fairness bug, not a display bug. It was sharper still when clients
 * ended segments off these numbers — `useSegmentAutoExpire` and
 * `BonusTimeDisplay` did, so a skewed clock cut a speaker off early or let
 * them run long. Expiry is the server's now (`lib/debate/expiry-registry.ts`),
 * which makes the deadline itself sound; what a skewed clock still does is
 * tell a speaker they have two minutes left when they have six, and a speaker
 * paces what they say by the number in front of them. Speakers cannot be asked
 * to calibrate their machines for a debate to be fair; the correction belongs
 * here.
 *
 * The approach is NTP's, minus the parts that need a protocol: time a request,
 * compare the server's clock to the midpoint of the round trip, and keep the
 * sample that travelled fastest, because that is the one whose midpoint is
 * closest to the truth.
 */

export interface ClockSampleInput {
  /** Client clock immediately before the request went out. */
  requestStartedMs: number;
  /** Client clock immediately after the response came back. */
  responseReceivedMs: number;
  /** The server's own clock, as reported in that response. */
  serverNowMs: number;
}

export interface ClockSample {
  /** Add to a client timestamp to get server time. */
  offsetMs: number;
  /** How long the round trip took — the sample's margin of error. */
  roundTripMs: number;
  /** Client clock when this sample was taken. */
  takenAtMs: number;
}

/**
 * A stored sample is replaced by a slower one once it is this old, so a long
 * debate cannot be held hostage to one lucky early measurement while the
 * machine's clock drifts underneath it.
 */
export const SAMPLE_STALE_MS = 2 * 60_000;

/**
 * Turn one timed request into an offset, or null if the timings are not usable.
 *
 * The true server time sits somewhere between the moment the request left and
 * the moment the response arrived. Without knowing how the round trip split
 * between the two legs, the midpoint is the best estimate available, and it is
 * wrong by at most half the round trip.
 */
export function measureClockOffset(input: ClockSampleInput): ClockSample | null {
  const { requestStartedMs, responseReceivedMs, serverNowMs } = input;

  if (
    !Number.isFinite(requestStartedMs) ||
    !Number.isFinite(responseReceivedMs) ||
    !Number.isFinite(serverNowMs)
  ) {
    return null;
  }

  const roundTripMs = responseReceivedMs - requestStartedMs;
  // Negative means the client's clock moved backwards mid-request (an NTP
  // correction, or a laptop waking). Nothing can be concluded from it.
  if (roundTripMs < 0) return null;

  const clientMidpointMs = requestStartedMs + roundTripMs / 2;
  return {
    offsetMs: serverNowMs - clientMidpointMs,
    roundTripMs,
    takenAtMs: responseReceivedMs,
  };
}

/**
 * Should a new sample replace the one being used?
 *
 * Prefer the fastest round trip, since its midpoint estimate is the tightest.
 * A slower sample still wins once the held one is stale, so drift is corrected
 * even on a connection that never produces another fast reading.
 */
export function shouldAcceptSample(
  current: ClockSample | null,
  candidate: ClockSample,
  nowMs: number,
): boolean {
  if (!current) return true;
  if (candidate.roundTripMs <= current.roundTripMs) return true;
  return nowMs - current.takenAtMs >= SAMPLE_STALE_MS;
}

// --- module state -----------------------------------------------------------
//
// Deliberately not in the Zustand store. Every consumer already re-renders on
// its own interval and reads the offset at tick time, so putting it in state
// would add re-renders without changing a single rendered frame.

let held: ClockSample | null = null;

/** Record a timed request against the server's clock. */
export function recordServerTime(input: ClockSampleInput): void {
  const candidate = measureClockOffset(input);
  if (!candidate) return;
  if (shouldAcceptSample(held, candidate, candidate.takenAtMs)) {
    held = candidate;
  }
}

/**
 * The current time, on the server's clock.
 *
 * Falls back to the local clock until a sample arrives, which is the old
 * behaviour — no worse than before, and corrected within one snapshot fetch.
 */
export function serverNow(): number {
  return Date.now() + (held?.offsetMs ?? 0);
}

/** The correction currently applied, for diagnostics. */
export function clockOffsetMs(): number {
  return held?.offsetMs ?? 0;
}

/** Test seam — drops the held sample. */
export function resetClock(): void {
  held = null;
}
