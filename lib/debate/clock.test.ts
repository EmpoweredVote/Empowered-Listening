import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  measureClockOffset,
  shouldAcceptSample,
  recordServerTime,
  serverNow,
  clockOffsetMs,
  resetClock,
  SAMPLE_STALE_MS,
  type ClockSample,
} from './clock';

describe('measureClockOffset', () => {
  it('reports no offset when the clocks agree and the trip is instant', () => {
    const sample = measureClockOffset({
      requestStartedMs: 1_000,
      responseReceivedMs: 1_000,
      serverNowMs: 1_000,
    });
    expect(sample).toEqual({ offsetMs: 0, roundTripMs: 0, takenAtMs: 1_000 });
  });

  it('splits the round trip, attributing half to each leg', () => {
    // Server answered at 1_100 somewhere inside a 200ms round trip starting at
    // 1_000, so the best guess is that the client's 1_100 was the server's
    // 1_100 — no offset, despite the response arriving at 1_200.
    const sample = measureClockOffset({
      requestStartedMs: 1_000,
      responseReceivedMs: 1_200,
      serverNowMs: 1_100,
    });
    expect(sample).toMatchObject({ offsetMs: 0, roundTripMs: 200 });
  });

  it('measures a client clock running behind the server as a positive offset', () => {
    // The real case: a client four minutes slow must have time added to it.
    const fourMinutes = 4 * 60_000;
    const sample = measureClockOffset({
      requestStartedMs: 1_000,
      responseReceivedMs: 1_000,
      serverNowMs: 1_000 + fourMinutes,
    });
    expect(sample?.offsetMs).toBe(fourMinutes);
  });

  it('measures a client clock running ahead as a negative offset', () => {
    const sample = measureClockOffset({
      requestStartedMs: 10_000,
      responseReceivedMs: 10_000,
      serverNowMs: 7_000,
    });
    expect(sample?.offsetMs).toBe(-3_000);
  });

  it('rejects a round trip that ended before it began', () => {
    // The client clock jumped backwards mid-request; nothing can be concluded.
    expect(measureClockOffset({
      requestStartedMs: 5_000,
      responseReceivedMs: 4_000,
      serverNowMs: 5_000,
    })).toBeNull();
  });

  it.each([
    ['NaN server time', { requestStartedMs: 1, responseReceivedMs: 2, serverNowMs: NaN }],
    ['Infinite start', { requestStartedMs: Infinity, responseReceivedMs: 2, serverNowMs: 3 }],
  ])('rejects %s', (_label, input) => {
    expect(measureClockOffset(input)).toBeNull();
  });
});

describe('shouldAcceptSample', () => {
  const held: ClockSample = { offsetMs: 500, roundTripMs: 100, takenAtMs: 10_000 };

  it('accepts anything when nothing is held', () => {
    expect(shouldAcceptSample(null, { offsetMs: 0, roundTripMs: 9_999, takenAtMs: 1 }, 1)).toBe(true);
  });

  it('accepts a faster round trip', () => {
    expect(shouldAcceptSample(held, { ...held, roundTripMs: 40 }, 10_100)).toBe(true);
  });

  it('accepts an equally fast round trip, so drift is picked up', () => {
    expect(shouldAcceptSample(held, { ...held, roundTripMs: 100 }, 10_100)).toBe(true);
  });

  it('rejects a slower round trip while the held sample is fresh', () => {
    // A measurement taken during a network hiccup is worse than the one held.
    expect(shouldAcceptSample(held, { ...held, roundTripMs: 3_000 }, 10_100)).toBe(false);
  });

  it('accepts a slower round trip once the held sample is stale', () => {
    const now = held.takenAtMs + SAMPLE_STALE_MS;
    expect(shouldAcceptSample(held, { ...held, roundTripMs: 3_000 }, now)).toBe(true);
  });

  it('still rejects a slower sample one millisecond short of stale', () => {
    const now = held.takenAtMs + SAMPLE_STALE_MS - 1;
    expect(shouldAcceptSample(held, { ...held, roundTripMs: 3_000 }, now)).toBe(false);
  });
});

describe('serverNow', () => {
  beforeEach(() => {
    resetClock();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetClock();
  });

  it('falls back to the local clock before any sample', () => {
    vi.setSystemTime(50_000);
    expect(clockOffsetMs()).toBe(0);
    expect(serverNow()).toBe(50_000);
  });

  it('corrects a slow client clock after one sample', () => {
    vi.setSystemTime(50_000);
    // Client reads 50_000 while the server reads 290_000: four minutes slow.
    recordServerTime({
      requestStartedMs: 50_000,
      responseReceivedMs: 50_000,
      serverNowMs: 290_000,
    });
    expect(serverNow()).toBe(290_000);
  });

  it('keeps the faster of two samples', () => {
    vi.setSystemTime(1_000);
    recordServerTime({ requestStartedMs: 0, responseReceivedMs: 1_000, serverNowMs: 2_000 });
    const fromSlow = clockOffsetMs();

    // A much faster trip disagrees — and should win.
    recordServerTime({ requestStartedMs: 1_000, responseReceivedMs: 1_010, serverNowMs: 5_000 });
    expect(clockOffsetMs()).not.toBe(fromSlow);
    expect(clockOffsetMs()).toBe(5_000 - 1_005);
  });

  it('ignores a slower contradicting sample while the good one is fresh', () => {
    vi.setSystemTime(1_000);
    recordServerTime({ requestStartedMs: 1_000, responseReceivedMs: 1_010, serverNowMs: 5_000 });
    const good = clockOffsetMs();

    recordServerTime({ requestStartedMs: 1_010, responseReceivedMs: 9_010, serverNowMs: 99_000 });
    expect(clockOffsetMs()).toBe(good);
  });

  it('brings two differently-skewed clients to within the 200ms target', () => {
    // The spec: under 200ms variance across connected clients. Two machines,
    // one 4 minutes slow and one 90 seconds fast, each measuring over a 120ms
    // round trip, must agree on the deadline to well inside that budget.
    const serverAtMeasurement = 1_000_000;
    const deadline = serverAtMeasurement + 300_000;

    function remainingFor(clientSkewMs: number, roundTripMs: number): number {
      resetClock();
      const clientStart = serverAtMeasurement - clientSkewMs - roundTripMs / 2;
      vi.setSystemTime(clientStart + roundTripMs);
      recordServerTime({
        requestStartedMs: clientStart,
        responseReceivedMs: clientStart + roundTripMs,
        serverNowMs: serverAtMeasurement,
      });
      return deadline - serverNow();
    }

    const slow = remainingFor(4 * 60_000, 120);
    const fast = remainingFor(-90_000, 120);
    expect(Math.abs(slow - fast)).toBeLessThan(200);
  });
});
