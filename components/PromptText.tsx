"use client";

import { useRef, useState } from "react";

/**
 * A published prompt, folded. Its text is fetched from the plain file the first time it opens,
 * so a stack page doesn't carry every prompt it lists. Without JavaScript the file link still works.
 */
export function PromptText({ file, id, summary, children }: { file: string; id: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  return (
    <details
      className="prompt"
      id={`prompt-${id}`}
      onToggle={(e) => {
        if (!e.currentTarget.open || asked.current) return;
        asked.current = true;
        fetch(file)
          .then((r) => (r.ok ? r.text() : Promise.reject()))
          // The file starts with a front-matter header; the prompt is everything after it.
          .then((t) => setText(t.replace(/^---\n[\s\S]*?\n---\n+/, "").replace(/\s+$/, "")))
          .catch(() => setFailed(true));
      }}
    >
      <summary>{summary}</summary>
      {children}
      <pre id={`prompt-text-${id}`} aria-busy={text === undefined && !failed}>
        <code>{text ?? (failed ? "Couldn't load the prompt. Use the plain text link below." : "Loading…")}</code>
      </pre>
    </details>
  );
}
