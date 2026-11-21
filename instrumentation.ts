export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { setDefaultResultOrder } = await import('node:dns');
    setDefaultResultOrder('ipv4first');

    // Ends a debate everybody has left. See lib/debate/abandon-watch.ts for
    // why this lives in the web process and what that assumes about instance
    // count. Wrapped because a watcher that cannot start is a backstop we
    // lose, not a reason to refuse to serve.
    try {
      const { startAbandonWatch, ABANDON_POLL_MS } = await import('./lib/debate/abandon-watch');
      startAbandonWatch();
      console.log(`[abandon-watch] started — polling every ${ABANDON_POLL_MS / 1000}s`);
    } catch (err) {
      console.error('[abandon-watch] failed to start:', err);
    }
  }
}
