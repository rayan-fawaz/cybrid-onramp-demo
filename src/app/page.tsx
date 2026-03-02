"use client";

import { useEffect, useCallback } from "react";
import { STEPS } from "@/lib/types";
import { useWorkflow } from "@/hooks/useWorkflow";
import { StatusPill } from "@/components/StatusPill";
import { DebugPanel } from "@/components/DebugPanel";
import { KVRow } from "@/components/KVRow";
import { CopyButton } from "@/components/CopyButton";
import { PlaidLinkStep } from "@/components/PlaidLinkStep";

export default function Home() {
  const wf = useWorkflow();

  // Load stored state on mount
  useEffect(() => {
    wf.refreshStore();
    wf.refreshBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStepClick = useCallback(
    (stepId: string) => {
      if (wf.isStepEnabled(stepId)) {
        wf.setActiveStep(stepId);
      }
    },
    [wf]
  );

  const handleRunStep = useCallback(
    async (stepId: string) => {
      if (!wf.isStepEnabled(stepId)) return;
      wf.setActiveStep(stepId);
      try {
        await wf.runStep(stepId);
        // Auto-advance to next step
        const idx = STEPS.findIndex((s) => s.id === stepId);
        if (idx < STEPS.length - 1) {
          wf.setActiveStep(STEPS[idx + 1].id);
        }
      } catch {
        // error already handled in hook
      }
    },
    [wf]
  );

  const activeStepDef = STEPS.find((s) => s.id === wf.activeStep);
  const activeState = wf.stepStates[wf.activeStep];

  return (
    <div className="console-layout">
      {/* ─── Header ──────────────────────────────────────── */}
      <header className="console-header">
        <div className="console-header__left">
          <h1 className="console-header__title">⚡ Cybrid On-Ramp Console</h1>
          <span className="env-badge">Sandbox</span>
        </div>
        <div className="console-header__right">
          {wf.storedState.customer_guid && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
              Customer: <code style={{ color: "var(--text-secondary)" }}>{wf.storedState.customer_guid.slice(0, 8)}...</code>
              <CopyButton text={wf.storedState.customer_guid} />
            </span>
          )}
          <button className="btn btn--secondary btn--sm" onClick={() => { wf.refreshStore(); wf.refreshBalances(); }}>
            ↻ Refresh
          </button>
          <button className="btn btn--primary btn--sm" onClick={wf.runAll}>
            ▶ Run All (Auto)
          </button>
          <button className="btn btn--danger btn--sm" onClick={wf.resetFlow}>
            ✕ Reset Flow
          </button>
        </div>
      </header>

      {/* ─── Sidebar: Step List ──────────────────────────── */}
      <aside className="console-sidebar">
        <div className="console-sidebar__title">Workflow Steps</div>
        {STEPS.map((step) => {
          const status = wf.getStepStatus(step.id);
          const enabled = wf.isStepEnabled(step.id);
          const isActive = wf.activeStep === step.id;

          let numberClass = "step-item__number";
          if (status === "complete") numberClass += " step-item__number--complete";
          else if (status === "skipped") numberClass += " step-item__number--complete";
          else if (status === "running") numberClass += " step-item__number--running";
          else if (status === "error") numberClass += " step-item__number--error";

          return (
            <div
              key={step.id}
              className={`step-item ${isActive ? "step-item--active" : ""} ${!enabled ? "step-item--disabled" : ""}`}
              onClick={() => handleStepClick(step.id)}
            >
              <div className={numberClass}>
                {status === "complete" ? "✓" : status === "skipped" ? "⏭" : status === "error" ? "✕" : step.number}
              </div>
              <div className="step-item__content">
                <div className="step-item__title">
                  {step.title}
                  <span style={{ marginLeft: 8 }}>
                    <StatusPill status={status} />
                  </span>
                </div>
                <div className="step-item__desc">{step.description}</div>
              </div>
            </div>
          );
        })}
      </aside>

      {/* ─── Main Content ────────────────────────────────── */}
      <main className="console-main">
        {/* Balances Bar */}
        <div className="balances-bar">
          <div className="balance-card">
            <div className="balance-card__label">USD Balance</div>
            <div className={`balance-card__value ${!wf.balances.usd ? "balance-card__value--loading" : ""}`}>
              {wf.balances.usd ?? "—"}
            </div>
            {wf.balances.usdAvailable && (
              <div className="balance-card__sub">Available: {wf.balances.usdAvailable}</div>
            )}
          </div>
          <div className="balance-card">
            <div className="balance-card__label">USDC Balance</div>
            <div className={`balance-card__value ${!wf.balances.usdc ? "balance-card__value--loading" : ""}`}>
              {wf.balances.usdc ?? "—"}
            </div>
            {wf.balances.usdcAvailable && (
              <div className="balance-card__sub">Available: {wf.balances.usdcAvailable}</div>
            )}
          </div>
          <div className="balance-card">
            <div className="balance-card__label">Flow Progress</div>
            <div className="balance-card__value">
              {STEPS.filter((s) => { const st = wf.getStepStatus(s.id); return st === "complete" || st === "skipped"; }).length}/{STEPS.length}
            </div>
            <div className="balance-card__sub">
              {STEPS.filter((s) => { const st = wf.getStepStatus(s.id); return st === "complete" || st === "skipped"; }).length === STEPS.length
                ? "🎉 On-ramp complete!"
                : `Next: ${STEPS.find((s) => { const st = wf.getStepStatus(s.id); return st !== "complete" && st !== "skipped"; })?.title ?? "—"}`}
            </div>
          </div>
        </div>

        {/* Active Step Detail */}
        {activeStepDef && (
          <div className="step-detail">
            <div className="step-detail__header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="step-detail__title">
                  Step {activeStepDef.number}: {activeStepDef.title}
                </span>
                <StatusPill status={activeState?.status ?? "idle"} />
              </div>
              <div className="step-detail__actions">
                {wf.activeStep !== "plaid" && (
                  <button
                    className="btn btn--primary"
                    disabled={!wf.isStepEnabled(wf.activeStep) || activeState?.status === "running"}
                    onClick={() => handleRunStep(wf.activeStep)}
                  >
                    {activeState?.status === "running" ? (
                      <><span className="spinner spinner--sm" /> Running...</>
                    ) : activeState?.status === "complete" ? (
                      "↻ Re-run"
                    ) : (
                      "▶ Execute"
                    )}
                  </button>
                )}
                {activeStepDef.skippable && activeState?.status !== "skipped" && (
                  <button
                    className="btn btn--secondary"
                    disabled={!wf.isStepEnabled(wf.activeStep) || activeState?.status === "running"}
                    onClick={() => wf.skipStep(wf.activeStep)}
                    title="Sandbox allows trading without fiat balance"
                  >
                    ⏭ Skip (Sandbox)
                  </button>
                )}
                {!wf.isStepEnabled(wf.activeStep) && (
                  <span style={{ fontSize: 12, color: "var(--color-warning)", display: "flex", alignItems: "center", gap: 4 }}>
                    ⚠ Complete &quot;{STEPS.find((s) => s.id === activeStepDef.prerequisite)?.title}&quot; first
                  </span>
                )}
              </div>
            </div>
            <div className="step-detail__body">
              <p className="step-detail__desc">{activeStepDef.description}</p>

              {/* Plaid step has special UI */}
              {wf.activeStep === "plaid" && (
                <PlaidLinkStep
                  status={activeState?.status ?? "idle"}
                  enabled={wf.isStepEnabled("plaid")}
                  plaidLinkToken={wf.plaidLinkToken}
                  onGetToken={wf.runPlaidGetToken}
                  onExchange={wf.runPlaidExchange}
                />
              )}

              {/* Error display */}
              {activeState?.error && (
                <div className="error-alert">
                  <strong>Error:</strong> {activeState.error}
                </div>
              )}

              {/* Result display */}
              {activeState?.response && (
                <div className="step-detail__result">
                  <div className="step-detail__result-title">Result</div>
                  {renderStepResult(wf.activeStep, activeState.response)}
                </div>
              )}

              {/* Debug accordion */}
              <DebugPanel
                data={activeState?.response}
                endpoint={activeState?.endpoint ?? undefined}
                method={activeState?.method ?? undefined}
              />
            </div>
          </div>
        )}

        {/* Live State Panel */}
        <div className="live-panel">
          <div className="live-panel__header">
            <span className="live-panel__title">📋 Live State (stored GUIDs)</span>
            <button className="btn btn--secondary btn--sm" onClick={wf.refreshStore}>
              ↻ Refresh
            </button>
          </div>
          <div className="live-panel__body">
            <KVRow label="Customer" value={wf.storedState.customer_guid} copyable />
            <KVRow label="Identity Verification" value={wf.storedState.identity_verification_guid} copyable />
            <KVRow label="Fiat Account (USD)" value={wf.storedState.fiat_account_guid} copyable />
            <KVRow label="Trading Account (USDC)" value={wf.storedState.trading_account_guid} copyable />
            <KVRow label="External Bank" value={wf.storedState.external_bank_account_guid} copyable />
            <KVRow label="Transfer" value={wf.storedState.transfer_guid} copyable />
            <KVRow label="Trade" value={wf.storedState.trade_guid} copyable />
            <KVRow label="Workflow" value={wf.storedState.workflow_guid} copyable />
          </div>
        </div>

        {/* Activity Feed */}
        <div className="live-panel">
          <div className="live-panel__header">
            <span className="live-panel__title">📜 Activity Log</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {wf.activity.length} events
            </span>
          </div>
          <div className="live-panel__body">
            {wf.activity.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                No activity yet. Click a step to begin.
              </p>
            ) : (
              <div className="activity-feed">
                {wf.activity.map((item) => (
                  <div key={item.id} className="activity-item">
                    <span className={`activity-item__icon activity-item__icon--${item.type}`}>
                      {item.type === "success" ? "✓" : item.type === "error" ? "✕" : "●"}
                    </span>
                    <span className="activity-item__text">{item.text}</span>
                    <span className="activity-item__time">{item.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─── Step result renderers ──────────────────────────────── */

function renderStepResult(stepId: string, data: Record<string, unknown>) {
  switch (stepId) {
    case "auth":
      return (
        <>
          <KVRow label="Status" value={data.authenticated ? "✅ Connected" : "❌ Failed"} />
          <KVRow label="Token" value={data.token_preview as string} />
        </>
      );
    case "customer":
      return (
        <>
          <KVRow label="GUID" value={(data.customer as Record<string, string>)?.guid} copyable />
          <KVRow label="State" value={(data.customer as Record<string, string>)?.state} />
          <KVRow label="Type" value={(data.customer as Record<string, string>)?.type} />
        </>
      );
    case "kyc":
      return (
        <>
          <KVRow label="Verification GUID" value={(data.verification as Record<string, string>)?.guid} copyable />
          <KVRow label="State" value={(data.verification as Record<string, string>)?.state} />
          <KVRow label="Outcome" value={(data.verification as Record<string, string>)?.outcome} />
          <KVRow label="Customer State" value={(data.customer as Record<string, string>)?.state} />
        </>
      );
    case "accounts":
      return (
        <>
          <KVRow label="Fiat GUID" value={(data.fiat_account as Record<string, string>)?.guid} copyable />
          <KVRow label="Fiat Asset" value={(data.fiat_account as Record<string, string>)?.asset} />
          <KVRow label="Fiat Balance" value={(data.fiat_account as Record<string, string>)?.balance_usd} />
          <KVRow label="Trading GUID" value={(data.trading_account as Record<string, string>)?.guid} copyable />
          <KVRow label="Trading Asset" value={(data.trading_account as Record<string, string>)?.asset} />
          <KVRow label="Trading Balance" value={(data.trading_account as Record<string, string>)?.balance_usdc} />
        </>
      );
    case "plaid":
      return (
        <>
          <KVRow label="Bank GUID" value={data.external_bank_account_guid as string} copyable />
          <KVRow label="Bank Name" value={data.name as string} />
          <KVRow label="Masked Account" value={data.mask as string} />
          <KVRow label="State" value={data.state as string} />
        </>
      );
    case "fund":
      return (
        <>
          <KVRow label="Transfer GUID" value={data.transfer_guid as string} copyable />
          <KVRow label="Amount" value={data.amount_usd as string} />
          <KVRow label="Fee" value={data.fee_usd as string} />
          <KVRow label="State" value={data.state as string} />
          <KVRow label="Payment Rail" value={data.payment_rail as string} />
        </>
      );
    case "convert":
      return (
        <>
          <KVRow label="Trade GUID" value={data.trade_guid as string} copyable />
          <KVRow label="USD Spent" value={data.usd_spent as string} />
          <KVRow label="USDC Received" value={data.usdc_received as string} />
          <KVRow label="Fee" value={data.fee as string} />
          <KVRow label="State" value={data.state as string} />
          {data.message && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--color-success-bg)", borderRadius: 6, color: "var(--color-success)", fontSize: 13 }}>
              {data.message as string}
            </div>
          )}
        </>
      );
    default:
      return <pre style={{ fontSize: 11, color: "var(--text-secondary)" }}>{JSON.stringify(data, null, 2)}</pre>;
  }
}
