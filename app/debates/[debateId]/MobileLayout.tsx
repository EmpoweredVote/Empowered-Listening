'use client';

import HlsPlayer from './HlsPlayer';
import { SegmentTimeline } from './SegmentTimeline';
import { MobileTabs, type MobileTab } from './MobileTabs';

interface MobileLayoutProps {
  hlsUrl: string | null;
  status: 'live' | 'completed' | 'scheduled';
  topic: string | null;
}

export function MobileLayout({ hlsUrl, status, topic }: MobileLayoutProps) {
  const videoContent = (
    <div className="relative w-full aspect-video bg-black">
      {hlsUrl ? (
        <HlsPlayer src={hlsUrl} badgeLabel={status === 'completed' ? 'Recorded' : undefined} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {status === 'scheduled' ? 'Waiting for debate to start…' : 'Stream unavailable.'}
        </div>
      )}
    </div>
  );

  const tabs: MobileTab[] = [
    {
      id: 'info',
      label: 'Info',
      content: (
        <div className="p-4 space-y-3 text-sm text-slate-200">
          <h2 className="text-base font-semibold">{topic ?? 'Debate'}</h2>
          <p className="text-slate-400">
            This is a live debate. The segment timeline shows the current phase.
            Transcript and notes will be available in later phases.
          </p>
        </div>
      ),
    },
    {
      id: 'transcript',
      label: 'Transcript',
      content: (
        <div className="p-4 text-sm text-slate-400">
          Transcript — available in a future update (Phase 4).
        </div>
      ),
    },
    {
      id: 'notes',
      label: 'Notes',
      content: (
        <div className="p-4 text-sm text-slate-400">
          Notes — available in a future update (Phase 5).
        </div>
      ),
    },
  ];

  return (
    <div className="h-screen bg-slate-950 text-slate-100">
      {/* Portrait layout: video + sticky timeline + tabs */}
      <div className="portrait:flex portrait:flex-col landscape:hidden h-full">
        {videoContent}
        <div className="sticky top-0 z-10">
          <SegmentTimeline variant="mobile" />
        </div>
        <MobileTabs tabs={tabs} className="flex-1 min-h-0" />
      </div>

      {/* Landscape layout: two panels */}
      <div className="landscape:flex portrait:hidden flex-row h-full">
        <div className="w-3/5 h-full bg-black">
          <div className="relative h-full">
            {hlsUrl ? (
              <HlsPlayer src={hlsUrl} className="h-full" badgeLabel={status === 'completed' ? 'Recorded' : undefined} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                {status === 'scheduled' ? 'Waiting for debate to start…' : 'Stream unavailable.'}
              </div>
            )}
          </div>
        </div>
        <div className="w-2/5 h-full overflow-y-auto border-l border-slate-800 p-4 flex flex-col gap-4">
          <h2 className="text-base font-semibold">{topic ?? 'Debate'}</h2>
          <SegmentTimeline variant="mobile" />
          <p className="text-sm text-slate-400">
            Rotate to portrait for the full multi-tab experience.
          </p>
        </div>
      </div>
    </div>
  );
}
