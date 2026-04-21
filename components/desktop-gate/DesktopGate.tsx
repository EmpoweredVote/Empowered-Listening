'use client';

import { useState } from 'react';

interface DesktopGateProps {
  joinUrl: string;
}

export function DesktopGate({ joinUrl }: DesktopGateProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked; URL is shown inline as fallback.
    }
  };

  return (
    <main role="alert" aria-live="polite" className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-6 text-center max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-ev-muted-blue">Join on a desktop browser</h1>
      <p className="text-base text-slate-700">
        The speaker and moderator views need a keyboard and a larger screen to work right.  Open this link on a desktop browser to continue.
      </p>
      <div className="flex flex-col gap-2 w-full">
        <code className="block bg-slate-100 text-sm px-3 py-2 rounded break-all">{joinUrl}</code>
        <button
          onClick={handleCopy}
          type="button"
          className="inline-flex items-center justify-center rounded-md bg-ev-muted-blue px-4 py-2 text-white font-medium hover:opacity-90 transition"
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </main>
  );
}
