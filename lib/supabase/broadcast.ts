import 'server-only';
import { env } from '@/lib/env';

/**
 * Send a Supabase Realtime broadcast from the server, over HTTP.
 *
 * The transcript worker used to do this through supabase-js:
 *
 *     const channel = supabase.channel(`transcript-${debateId}`);
 *     await channel.send({ type: 'broadcast', event: 'final', payload });
 *     await supabase.removeChannel(channel);
 *
 * Every one of those failed in production with
 * `Node.js detected but native WebSocket not found` — supabase-js opens a
 * WebSocket to deliver a broadcast, and the server bundle has no WebSocket for
 * it to use. The transcript row was still written to the database, so the text
 * appeared on a page refresh and vanished from the live view, which made it
 * look like flaky Realtime rather than a send path that had never worked.
 *
 * Realtime also accepts broadcasts over plain HTTP, which is what a server-side
 * sender wants: no socket to establish, no channel to create and tear down per
 * message, and nothing to keep alive between them. The old code built and
 * destroyed a channel for every interim result — several a second — and each
 * one threw.
 *
 * Subscribers are unaffected: the browser still listens on the same topic for
 * the same events. Only the sending side changes.
 */

/** A broadcast that could not be delivered. Callers log; none of them retry. */
export class BroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastError';
  }
}

export interface BroadcastMessage {
  /** Channel name, exactly as the browser passes to `supabase.channel(...)`. */
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * POST one or more messages to Realtime's broadcast endpoint.
 *
 * Throws on a non-2xx response so callers can log it. A transcript line is not
 * worth retrying — by the time a retry landed, more speech would have arrived,
 * and the row is already durable in the database either way.
 */
export async function sendBroadcast(messages: BroadcastMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new BroadcastError(
      'Supabase credentials not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
    );
  }

  const res = await fetch(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new BroadcastError(
      `Realtime broadcast failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
}
