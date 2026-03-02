"use client";

import { useState, useCallback, useRef } from "react";
import { STEPS, StepState, StoredState, Balances, ActivityItem } from "@/lib/types";
import type { StepStatus } from "@/lib/types";

type StepStates = Record<string, StepState>;

function initialStepStates(): StepStates {
  const states: StepStates = {};
  for (const step of STEPS) {
    states[step.id] = { status: "idle", error: null, response: null, endpoint: null, method: null };
  }
  return states;
}

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function useWorkflow() {
  const [stepStates, setStepStates] = useState<StepStates>(initialStepStates);
  const [storedState, setStoredState] = useState<StoredState>({});
  const [balances, setBalances] = useState<Balances>({ usd: null, usdc: null, usdAvailable: null, usdcAvailable: null });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activeStep, setActiveStep] = useState<string>("auth");
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const abortRef = useRef(false);

  const addActivity = useCallback((text: string, type: "success" | "error" | "pending") => {
    setActivity((prev) => [{ id: crypto.randomUUID(), text, type, time: now() }, ...prev].slice(0, 50));
  }, []);

  const updateStep = useCallback((stepId: string, update: Partial<StepState>) => {
    setStepStates((prev) => ({ ...prev, [stepId]: { ...prev[stepId], ...update } }));
  }, []);

  const refreshStore = useCallback(async () => {
    try {
      const res = await fetch("/api/store");
      const data = await res.json();
      if (data.success) setStoredState(data.state);
    } catch { /* ignore */ }
  }, []);

  const refreshBalances = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setBalances({
          usd: data.fiat_account?.balance_display ?? null,
          usdc: data.trading_account?.balance_display ?? null,
          usdAvailable: data.fiat_account?.available_display ?? null,
          usdcAvailable: data.trading_account?.available_display ?? null,
        });
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Step runners ─────────────────────────────────────────

  const runAuth = useCallback(async () => {
    updateStep("auth", { status: "running", error: null, endpoint: "/api/auth", method: "GET" });
    addActivity("Authenticating with Cybrid sandbox...", "pending");
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Auth failed");
      updateStep("auth", { status: "complete", response: data });
      addActivity("Authenticated successfully", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("auth", { status: "error", error: msg });
      addActivity(`Auth failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity]);

  const runCreateCustomer = useCallback(async () => {
    updateStep("customer", { status: "running", error: null, endpoint: "/api/customer/create", method: "POST" });
    addActivity("Creating customer...", "pending");
    try {
      const res = await fetch("/api/customer/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create customer");
      updateStep("customer", { status: "complete", response: data });
      addActivity(`Customer created: ${data.customer?.guid?.slice(0, 8)}...`, "success");
      await refreshStore();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("customer", { status: "error", error: msg });
      addActivity(`Customer creation failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore]);

  const runKYC = useCallback(async () => {
    updateStep("kyc", { status: "running", error: null, endpoint: "/api/customer/verify/start", method: "POST" });
    addActivity("Starting KYC verification...", "pending");
    try {
      const res = await fetch("/api/customer/verify/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "KYC failed");
      updateStep("kyc", { status: "complete", response: data });
      addActivity(`KYC passed — customer verified`, "success");
      await refreshStore();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("kyc", { status: "error", error: msg });
      addActivity(`KYC failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore]);

  const runCreateAccounts = useCallback(async () => {
    updateStep("accounts", { status: "running", error: null, endpoint: "/api/accounts/create", method: "POST" });
    addActivity("Creating USD + USDC accounts...", "pending");
    try {
      const res = await fetch("/api/accounts/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create accounts");
      updateStep("accounts", { status: "complete", response: data });
      addActivity("Accounts created (USD fiat + USDC trading)", "success");
      await refreshStore();
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("accounts", { status: "error", error: msg });
      addActivity(`Account creation failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore, refreshBalances]);

  const runPlaidGetToken = useCallback(async (): Promise<string> => {
    updateStep("plaid", { status: "running", error: null, endpoint: "/api/plaid/workflow", method: "POST" });
    addActivity("Creating Plaid Link token...", "pending");
    try {
      const res = await fetch("/api/plaid/workflow", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get Plaid link token");
      setPlaidLinkToken(data.plaid_link_token);
      addActivity("Plaid Link token ready — open bank connection", "success");
      return data.plaid_link_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("plaid", { status: "error", error: msg });
      addActivity(`Plaid token failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity]);

  const runPlaidExchange = useCallback(async (publicToken: string, accountId: string) => {
    addActivity("Exchanging Plaid token for external bank account...", "pending");
    try {
      const res = await fetch("/api/plaid/external-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plaid_public_token: publicToken, plaid_account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to link bank account");
      updateStep("plaid", { status: "complete", response: data });
      addActivity(`Bank linked: ${data.name ?? "Bank Account"}`, "success");
      await refreshStore();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("plaid", { status: "error", error: msg });
      addActivity(`Bank linking failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore]);

  const runFund = useCallback(async () => {
    updateStep("fund", { status: "running", error: null, endpoint: "/api/transfers/create", method: "POST" });
    addActivity("Initiating ACH pull transfer...", "pending");
    try {
      const res = await fetch("/api/transfers/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transfer failed");
      updateStep("fund", { status: "complete", response: data });
      addActivity(`ACH deposit completed: ${data.amount_usd}`, "success");
      await refreshStore();
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("fund", { status: "error", error: msg });
      addActivity(`Transfer failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore, refreshBalances]);

  const runConvert = useCallback(async () => {
    updateStep("convert", { status: "running", error: null, endpoint: "/api/trades/quote", method: "POST" });
    addActivity("Getting USD→USDC quote...", "pending");
    try {
      // Step 1: Get quote
      const quoteRes = await fetch("/api/trades/quote", { method: "POST" });
      const quoteData = await quoteRes.json();
      if (!quoteRes.ok) throw new Error(quoteData.error ?? "Quote failed");
      addActivity(`Quote received: ${quoteData.you_spend} → ${quoteData.you_receive} (rate: ${quoteData.effective_rate})`, "success");

      // Step 2: Execute trade (must happen within 30s while quote is valid)
      addActivity("Executing trade before quote expires...", "pending");
      updateStep("convert", { endpoint: "/api/trades/execute", method: "POST" });
      const execRes = await fetch("/api/trades/execute", { method: "POST" });
      const execData = await execRes.json();
      if (!execRes.ok) throw new Error(execData.error ?? "Trade execution failed");

      // Step 3: Fetch final trade status with updated balances
      updateStep("convert", { endpoint: "/api/trades/status", method: "GET" });
      const statusRes = await fetch("/api/trades/status");
      const statusData = statusRes.ok ? await statusRes.json() : null;

      // Merge quote + execute + status into one response for the result panel
      const mergedResponse = {
        ...execData,
        quote_rate: quoteData.effective_rate,
        quote_fee: quoteData.fee,
        fiat_balance: statusData?.accounts?.fiat_usd?.balance ?? null,
        usdc_balance: statusData?.accounts?.trading_usdc?.balance ?? null,
        on_ramp_complete: statusData?.on_ramp_complete ?? execData.is_success,
      };

      updateStep("convert", { status: "complete", response: mergedResponse });
      addActivity(`Trade complete: ${execData.usd_spent} → ${execData.usdc_received}`, "success");
      await refreshStore();
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateStep("convert", { status: "error", error: msg });
      addActivity(`Conversion failed: ${msg}`, "error");
      throw e;
    }
  }, [updateStep, addActivity, refreshStore, refreshBalances]);

  // ─── Step dispatcher ──────────────────────────────────────

  const runStep = useCallback(async (stepId: string) => {
    switch (stepId) {
      case "auth": return runAuth();
      case "customer": return runCreateCustomer();
      case "kyc": return runKYC();
      case "accounts": return runCreateAccounts();
      case "plaid": return runPlaidGetToken();
      case "fund": return runFund();
      case "convert": return runConvert();
    }
  }, [runAuth, runCreateCustomer, runKYC, runCreateAccounts, runPlaidGetToken, runFund, runConvert]);

  // ─── Run all steps sequentially ───────────────────────────

  const runAll = useCallback(async () => {
    abortRef.current = false;
    const stepIds = ["auth", "customer", "kyc", "accounts"];
    // plaid requires user interaction, so we stop before it
    for (const id of stepIds) {
      if (abortRef.current) break;
      setActiveStep(id);
      try {
        await runStep(id);
      } catch {
        break; // stop on first failure
      }
    }
    setActiveStep("plaid");
  }, [runStep]);

  // ─── Reset ────────────────────────────────────────────────

  const resetFlow = useCallback(async () => {
    abortRef.current = true;
    try {
      await fetch("/api/store", { method: "DELETE" });
    } catch { /* ignore */ }
    setStepStates(initialStepStates());
    setStoredState({});
    setBalances({ usd: null, usdc: null, usdAvailable: null, usdcAvailable: null });
    setActivity([]);
    setActiveStep("auth");
    setPlaidLinkToken(null);
  }, []);

  // ─── Skip step (sandbox) ─────────────────────────────────

  const skipStep = useCallback((stepId: string) => {
    updateStep(stepId, { status: "skipped", error: null, response: { skipped: true, reason: "Sandbox mode — step not required for testing" } });
    addActivity(`Skipped: ${STEPS.find((s) => s.id === stepId)?.title ?? stepId} (sandbox)`, "success");
    // Auto-advance
    const idx = STEPS.findIndex((s) => s.id === stepId);
    if (idx < STEPS.length - 1) {
      setActiveStep(STEPS[idx + 1].id);
    }
  }, [updateStep, addActivity, setActiveStep]);

  // ─── Prerequisite check ───────────────────────────────────

  const isStepEnabled = useCallback((stepId: string): boolean => {
    const step = STEPS.find((s) => s.id === stepId);
    if (!step?.prerequisite) return true;
    const prereqStatus = stepStates[step.prerequisite]?.status;
    return prereqStatus === "complete" || prereqStatus === "skipped";
  }, [stepStates]);

  const getStepStatus = useCallback((stepId: string): StepStatus => {
    return stepStates[stepId]?.status ?? "idle";
  }, [stepStates]);

  return {
    stepStates,
    storedState,
    balances,
    activity,
    activeStep,
    plaidLinkToken,
    setActiveStep,
    runStep,
    runAll,
    resetFlow,
    isStepEnabled,
    getStepStatus,
    refreshStore,
    refreshBalances,
    runPlaidExchange,
    runPlaidGetToken,
    skipStep,
  };
}
