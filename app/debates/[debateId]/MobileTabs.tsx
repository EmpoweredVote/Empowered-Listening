'use client';

import { useRef, useState } from 'react';

export interface MobileTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface MobileTabsProps {
  tabs: MobileTab[];
  className?: string;
}

export function MobileTabs({ tabs, className = '' }: MobileTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  function scrollToTab(index: number) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.offsetWidth, behavior: 'smooth' });
    setActiveIndex(index);
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Tab bar at bottom (thumb-reachable) */}
      <div role="tablist" className="flex border-t border-slate-800 bg-slate-900 order-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeIndex === i}
            aria-controls={`mobile-tab-panel-${tab.id}`}
            onClick={() => scrollToTab(i)}
            className={`flex-1 py-3 text-xs font-medium min-h-[44px] ${
              activeIndex === i
                ? 'text-blue-400 border-t-2 border-blue-400'
                : 'text-slate-400 border-t-2 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Swipeable panels */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / el.offsetWidth);
          if (idx !== activeIndex) setActiveIndex(idx);
        }}
        className="flex flex-1 overflow-x-auto snap-x snap-mandatory order-1 min-h-0 no-scrollbar"
        style={{
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        } as React.CSSProperties}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`mobile-tab-panel-${tab.id}`}
            role="tabpanel"
            className="snap-start flex-shrink-0 w-full h-full overflow-y-auto"
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
