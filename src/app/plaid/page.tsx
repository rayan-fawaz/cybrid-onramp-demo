"use client";

/**
 * /plaid — Standalone Plaid Link test page.
 *
 * This page is an ALTERNATIVE to the main dashboard's step-5 Plaid integration.
 * It's useful for testing Plaid Link in isolation, outside the full workflow.
 *
 * Flow:
 *   1. On mount, fetches a Plaid link_token from /api/plaid/workflow
 *   2. Opens the Plaid Link modal when the user clicks "Connect Bank Account"
 *   3. Exchanges the public_token via /api/plaid/external-bank
 *
 * Sandbox credentials: user_good / pass_good
 */

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink, PlaidLinkOptions, PlaidLinkOnSuccess } from "react-plaid-link";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "loading" | "success" | "error";

interface LinkResult {
  external_bank_account_guid: string;
  name: string;
  mask: string | null;
  institution: string | null;
  state: string;
  message: string;
}

// ─── PlaidButton Component ─────────────────────────────────────────────────────
// Extracted into its own component because usePlaidLink requires the token
// to already exist before the hook runs — we can't call hooks conditionally.

function PlaidButton({
  linkToken,
  onSuccess,
}: {
  linkToken: string;
  onSuccess: PlaidLinkOnSuccess;
}) {
  const config: PlaidLinkOptions = {
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      if (err) console.error("[Plaid] User exited with error:", err);
      else console.log("[Plaid] User closed the dialog");
    },
    onEvent: (eventName) => {
      console.log("[Plaid] Event:", eventName);
    },
  };

  const { open, ready } = usePlaidLink(config);

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{
        padding: "12px 24px",
        fontSize: "16px",
        backgroundColor: ready ? "#00b341" : "#aaa",
        color: "white",
        border: "none",
        borderRadius: "6px",
        cursor: ready ? "pointer" : "not-allowed",
        fontWeight: "bold",
      }}
    >
      {ready ? "🏦 Connect Bank Account" : "Loading Plaid..."}
    </button>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────────────

export default function PlaidPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<StepStatus>("idle");
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<StepStatus>("idle");
  const [saveResult, setSaveResult] = useState<LinkResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Step 1: Fetch link token from our backend ──────────────────────────────
  // When the page loads, we immediately request a link_token from Cybrid.
  // This is fast (~1-2 seconds) and we want it ready before the user clicks.
  useEffect(() => {
    async function fetchToken() {
      setTokenStatus("loading");
      setTokenError(null);

      try {
        const res = await fetch("/api/plaid/workflow");
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to get link token");
        }

        setLinkToken(data.plaid_link_token);
        setTokenStatus("success");
        console.log("[PlaidPage] Link token ready:", data.workflow_guid);
      } catch (err: unknown) {
        setTokenStatus("error");
        setTokenError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    fetchToken();
  }, []); // ← empty array = run once on mount

  // ── Step 2: Handle Plaid onSuccess ────────────────────────────────────────
  // Plaid calls this when the user successfully logs into their bank.
  // It gives us a one-time public_token and the metadata about what was linked.
  //
  // IMPORTANT: public_token expires in 30 minutes — send it to the server immediately!
  const handlePlaidSuccess = useCallback<PlaidLinkOnSuccess>(
    async (public_token, metadata) => {
      console.log("[PlaidPage] Plaid success! public_token:", public_token.slice(0, 20) + "...");
      console.log("[PlaidPage] Linked account metadata:", metadata);

      // metadata.accounts is an array, but we only support one account at a time
      const account = metadata.accounts[0];
      if (!account) {
        setSaveError("No account returned from Plaid");
        setSaveStatus("error");
        return;
      }

      // ── Step 3: Exchange with Cybrid ─────────────────────────────────────
      setSaveStatus("loading");
      setSaveError(null);

      try {
        const res = await fetch("/api/plaid/external-bank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plaid_public_token: public_token,
            plaid_account_id: account.id,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to link bank account");
        }

        setSaveResult(data);
        setSaveStatus("success");
        console.log("[PlaidPage] External bank account created:", data.external_bank_account_guid);
      } catch (err: unknown) {
        setSaveStatus("error");
        setSaveError(err instanceof Error ? err.message : "Unknown error");
      }
    },
    []
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main style={{ fontFamily: "monospace", padding: "40px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>Phase 5 — Plaid Bank Link</h1>
      <p style={{ color: "#555", marginBottom: "32px" }}>
        Connect a bank account using Plaid Link so we can fund the customer's Cybrid wallet via ACH.
      </p>

      {/* ── Token fetch status ── */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>Step 1: Get Plaid Link Token</h2>

        {tokenStatus === "loading" && <p style={{ color: "#888" }}>⏳ Requesting link token from Cybrid...</p>}
        {tokenStatus === "error" && (
          <p style={{ color: "red" }}>❌ Error: {tokenError}</p>
        )}
        {tokenStatus === "success" && (
          <p style={{ color: "green" }}>✅ Link token ready ({linkToken!.slice(0, 20)}...)</p>
        )}
      </section>

      {/* ── Plaid Link button (only shown once token is ready) ── */}
      {tokenStatus === "success" && linkToken && saveStatus === "idle" && (
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", marginBottom: "12px" }}>Step 2: Open Plaid & Select Bank</h2>
          <PlaidButton linkToken={linkToken} onSuccess={handlePlaidSuccess} />
          <p style={{ color: "#888", marginTop: "12px", fontSize: "13px" }}>
            Use sandbox credentials: <strong>username: user_good</strong> / <strong>password: pass_good</strong>
          </p>
        </section>
      )}

      {/* ── Saving status ── */}
      {saveStatus === "loading" && (
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", marginBottom: "8px" }}>Step 3: Registering Bank with Cybrid</h2>
          <p style={{ color: "#888" }}>⏳ Exchanging Plaid token with Cybrid...</p>
        </section>
      )}

      {saveStatus === "error" && (
        <section style={{ marginBottom: "32px" }}>
          <p style={{ color: "red" }}>❌ Error: {saveError}</p>
        </section>
      )}

      {/* ── Success result ── */}
      {saveStatus === "success" && saveResult && (
        <section
          style={{
            border: "1px solid #00b341",
            borderRadius: "8px",
            padding: "20px",
            backgroundColor: "#f0fff4",
          }}
        >
          <h2 style={{ fontSize: "16px", color: "#00b341", marginBottom: "12px" }}>
            ✅ Bank Account Linked!
          </h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[
                ["GUID", saveResult.external_bank_account_guid],
                ["Account Name", saveResult.name],
                ["Masked Number", saveResult.mask ?? "N/A"],
                ["Institution", saveResult.institution ?? "N/A"],
                ["State", saveResult.state],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={{ padding: "8px", fontWeight: "bold", width: "40%" }}>{label}</td>
                  <td style={{ padding: "8px", color: "#333" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: "16px", color: "#555" }}>{saveResult.message}</p>
          <p style={{ marginTop: "8px", color: "#888", fontSize: "13px" }}>
            Next: <a href="/api/plaid/external-bank" style={{ color: "#0070f3" }}>Check status</a>
            {" | "}
            Ready for Phase 6: ACH Funding →
          </p>
        </section>
      )}
    </main>
  );
}
