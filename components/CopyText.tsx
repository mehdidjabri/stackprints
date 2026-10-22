"use client";

import { useState } from "react";

/** Copies the text of an element already on the page, so long text isn't sent twice. */
export function CopyText({ target, label = "Copy" }: { target: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(document.getElementById(target)?.textContent ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
