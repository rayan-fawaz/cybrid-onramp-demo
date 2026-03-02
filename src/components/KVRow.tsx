"use client";

/**
 * KVRow — key/value display row used in result panels and the live-state sidebar.
 * Optionally shows a copy-to-clipboard button.
 */

import { CopyButton } from "./CopyButton";

interface KVRowProps {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
}

export function KVRow({ label, value, copyable = false }: KVRowProps) {
  const displayValue = value ?? "—";
  return (
    <div className="kv-row">
      <span className="kv-row__key">{label}</span>
      <span className="kv-row__value">
        {displayValue}
        {copyable && value && <CopyButton text={value} />}
      </span>
    </div>
  );
}
