import { ModeratorGate } from '@/components/auth/ModeratorGate';

/**
 * Every `/moderator/*` page sits behind one gate rather than each growing its
 * own — the same reason `teardownDebateMedia` exists for endings.  See
 * `components/auth/ModeratorGate.tsx` for what this is and, more importantly,
 * what it is not: the real gate is on the API routes, and these pages render
 * no debate data server-side.
 *
 * The layout stays a server component so the pages it wraps still render on
 * the server; only the gate around them is client-side, because the token it
 * needs lives in localStorage.
 */
export default function ModeratorLayout({ children }: { children: React.ReactNode }) {
  return <ModeratorGate>{children}</ModeratorGate>;
}
