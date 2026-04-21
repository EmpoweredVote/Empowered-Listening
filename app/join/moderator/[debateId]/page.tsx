import { headers } from 'next/headers';
import { DesktopGate } from '@/components/desktop-gate/DesktopGate';

export default async function ModeratorJoinPage({
  params,
}: {
  params: Promise<{ debateId: string }>;
}) {
  const { debateId } = await params;
  const headerList = await headers();
  const isMobileGate = headerList.get('x-mobile-gate') === '1';
  const joinUrl = `https://listening.empowered.vote/join/moderator/${debateId}`;

  if (isMobileGate) {
    return <DesktopGate joinUrl={joinUrl} />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-6 text-center">
      <h1 className="text-2xl font-semibold text-ev-muted-blue">Moderator join: {debateId}</h1>
      <p className="text-base text-slate-700">
        Moderator room implementation begins in Phase 2.  You are authenticated.
      </p>
    </main>
  );
}
