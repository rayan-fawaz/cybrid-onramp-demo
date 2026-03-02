"use client";

import { useState, useCallback } from "react";
import { usePlaidLink, PlaidLinkOnSuccess, PlaidLinkOptions } from "react-plaid-link";
import type { StepStatus } from "@/lib/types";

interface PlaidLinkStepProps {
  status: StepStatus;
  enabled: boolean;
  plaidLinkToken: string | null;
  onGetToken: () => Promise<string>;
  onExchange: (publicToken: string, accountId: string) => Promise<void>;
}

function PlaidLinkButton({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
}) {
  const config: PlaidLinkOptions = {
    token,
    onSuccess,
    onExit: (err) => {
      if (err) console.error("[Plaid] exit with error:", err);
    },
    onEvent: (eventName) => {
      console.log("[Plaid] event:", eventName);
    },
  };

  const { open, ready } = usePlaidLink(config);

  return (
    <button
      className="btn btn--success"
      onClick={() => open()}
      disabled={!ready}
    >
      {ready ? "🏦 Connect Bank Account" : "Loading Plaid..."}
    </button>
  );
}

export function PlaidLinkStep({
  status,
  enabled,
  plaidLinkToken,
  onGetToken,
  onExchange,
}: PlaidLinkStepProps) {
  const [tokenLoading, setTokenLoading] = useState(false);
  const [localToken, setLocalToken] = useState<string | null>(plaidLinkToken);

  const handleGetToken = useCallback(async () => {
    setTokenLoading(true);
    try {
      const token = await onGetToken();
      setLocalToken(token);
    } catch {
      // handled upstream
    } finally {
      setTokenLoading(false);
    }
  }, [onGetToken]);

  const handlePlaidSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      const account = metadata.accounts[0];
      if (!account) return;
      await onExchange(publicToken, account.id);
    },
    [onExchange]
  );

  if (!enabled) {
    return (
      <div className="plaid-info">
        Complete the previous steps before linking a bank account.
      </div>
    );
  }

  if (status === "complete") {
    return null; // result is shown by parent
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Step A: Get link token */}
      {!localToken && status !== "running" && (
        <div>
          <button
            className="btn btn--primary"
            onClick={handleGetToken}
            disabled={tokenLoading}
          >
            {tokenLoading ? (
              <>
                <span className="spinner spinner--sm" /> Getting token...
              </>
            ) : (
              "▶ Get Plaid Link Token"
            )}
          </button>
        </div>
      )}

      {/* Step B: Show Plaid Link button */}
      {localToken && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="plaid-info">
            ✅ Link token ready. Click below to open Plaid and connect a sandbox bank.
            <br />
            <strong>Sandbox credentials:</strong> username: <code>user_good</code> / password: <code>pass_good</code>
          </div>
          <PlaidLinkButton token={localToken} onSuccess={handlePlaidSuccess} />
        </div>
      )}

      {/* Loading state during exchange */}
      {status === "running" && localToken && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-info)" }}>
          <span className="spinner" /> Linking bank account with Cybrid...
        </div>
      )}
    </div>
  );
}
