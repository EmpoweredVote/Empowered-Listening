export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { setDefaultResultOrder } = await import('node:dns');
    setDefaultResultOrder('ipv4first');

    // Segment expiry timers live in process memory, so a deploy or a restart
    // drops them. Without this, a debate that was mid-segment when the service
    // restarted would never advance again on its own. Re-armed before the
    // abandon watch starts, so a debate that is still being run is ticking
    // again before anything starts deciding whether it has been left.
    try {
      const { rescheduleActiveSegments } = await import('./lib/debate/expiry-registry');
      await rescheduleActiveSegments();
    } catch (err) {
      console.error('[expiry] failed to re-arm segment timers:', err);
    }

    // Ends a debate everybody has left. See lib/debate/abandon-watch.ts for
    // why this lives in the web process and what that assumes about instance
    // count. Wrapped because a watcher that cannot start is a backstop we
    // lose, not a reason to refuse to serve.
    try {
      const { startAbandonWatch, shouldStartAbandonWatch, ABANDON_POLL_MS } =
        await import('./lib/debate/abandon-watch');
      if (shouldStartAbandonWatch()) {
        startAbandonWatch();
        console.log(`[abandon-watch] started — polling every ${ABANDON_POLL_MS / 1000}s`);
      }
    } catch (err) {
      console.error('[abandon-watch] failed to start:', err);
    }
  }
}
