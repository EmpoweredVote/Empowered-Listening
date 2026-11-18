import 'server-only';
import { sendBroadcast } from '@/lib/supabase/broadcast';

/**
 * Tell every client watching a debate that its state has moved.
 *
 * Why a bare signal rather than the changed rows: the client answers it by
 * re-fetching `/api/debates/[id]/snapshot`, which it already does on mount.
 * That keeps one definition of the shape clients consume, so a column added
 * to debates, debate_segments or debate_speakers cannot leave the live path
 * serving a stale shape while the mount path serves the new one. Transitions
 * happen a handful of times per debate, so the extra round trip costs nothing
 * that matters.
 *
 * This replaced `postgres_changes`, which subscribed cleanly and then
 * delivered nothing — the same failure the transcript hit. Its cost here was
 * that a speaker's store never learned the segment had changed, so the mic
 * hook kept evaluating against the previous segment and speakers had to
 * reload the page at every transition to get their microphone.
 */
export async function notifyDebateChanged(debateId: string, reason: string): Promise<void> {
  try {
    const payload = { reason, at: new Date().toISOString() };
    // Participants and observers listen on separate topics, deliberately: the
    // two hooks read different snapshot endpoints, and an anonymous observer
    // must not share a channel name with a signed-in participant in the same
    // browser. Both get the same nudge, in one request.
    await sendBroadcast([
      { topic: `debate-${debateId}`, event: 'changed', payload },
      { topic: `observer-debate-${debateId}`, event: 'changed', payload },
    ]);
  } catch (err) {
    // Never fatal to the transition that triggered it. The write already
    // landed; losing the nudge costs liveness, not correctness, and clients
    // re-fetch on tab focus anyway.
    console.error(`[notify] debate ${debateId} (${reason}) broadcast failed:`, err);
  }
}
