export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { setDefaultResultOrder } = await import('node:dns');
    setDefaultResultOrder('ipv4first');

    // Segment expiry timers live in process memory, so a deploy or a restart
    // drops them. Without this, a debate that was mid-segment when the service
    // restarted would never advance again on its own.
    const { rescheduleActiveSegments } = await import('@/lib/debate/expiry-registry');
    await rescheduleActiveSegments();
  }
}
