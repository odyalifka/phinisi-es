'use client';

import { useState } from 'react';

export default function CopyReportButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
    >
      {copied ? 'Tersalin ke Clipboard!' : 'Salin Ringkasan Laporan (WA)'}
    </button>
  );
}