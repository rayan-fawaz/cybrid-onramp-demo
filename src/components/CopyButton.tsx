"use client";

import { useState, useCallback } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      className={`copy-btn ${copied ? "copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
