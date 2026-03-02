"use client";

/**
 * StatusPill — colour-coded badge reflecting a workflow step's state.
 *
 *   idle → grey    running → blue    complete → green
 *   error → red    skipped → yellow
 */

import type { StepStatus } from "@/lib/types";

const LABELS: Record<StepStatus, string> = {
  idle: "Not Started",
  running: "Running",
  complete: "Complete",
  error: "Failed",
  skipped: "Skipped",
};

export function StatusPill({ status }: { status: StepStatus }) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      {status === "running" && <span className="spinner spinner--sm" />}
      {LABELS[status]}
    </span>
  );
}
