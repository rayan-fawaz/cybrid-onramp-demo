"use client";

import { useState } from "react";

interface DebugPanelProps {
  data: Record<string, unknown> | null;
  endpoint?: string;
  method?: string;
}

export function DebugPanel({ data, endpoint, method }: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  if (!data) return null;

  return (
    <div className="debug-panel">
      <button className="debug-panel__trigger" onClick={() => setOpen(!open)}>
        <span>
          {endpoint ? `${method ?? "GET"} ${endpoint}` : "Request / Response (debug)"}
        </span>
        <span className={`debug-panel__trigger-icon ${open ? "debug-panel__trigger-icon--open" : ""}`}>
          ▶
        </span>
      </button>
      {open && (
        <div className="debug-panel__content">
          <pre className="debug-panel__pre">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
