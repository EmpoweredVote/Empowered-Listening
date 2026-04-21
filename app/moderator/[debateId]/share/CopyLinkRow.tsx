'use client';

import { useState } from 'react';

export function CopyLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly value={url}
          className="flex-1 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="rounded bg-ev-muted-blue px-3 py-1.5 text-sm text-white hover:opacity-90"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
