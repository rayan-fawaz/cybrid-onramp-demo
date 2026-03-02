/**
 * Shared types and step definitions for the Cybrid on-ramp workflow.
 *
 * The STEPS array defines the 7-step wizard: auth → customer → kyc →
 * accounts → plaid → fund → convert. Each step has a prerequisite that
 * must be "complete" or "skipped" before it becomes enabled.
 */

export type StepStatus = "idle" | "running" | "complete" | "error" | "skipped";

export interface StepDefinition {
  id: string;
  number: number;
  title: string;
  description: string;
  prerequisite?: string; // step id that must be complete before this one
  skippable?: boolean;   // can be skipped in sandbox mode
}

export interface StepState {
  status: StepStatus;
  error: string | null;
  response: Record<string, unknown> | null;
  endpoint: string | null;
  method: string | null;
}

export interface Balances {
  usd: string | null;
  usdc: string | null;
  usdAvailable: string | null;
  usdcAvailable: string | null;
}

export interface StoredState {
  customer_guid?: string;
  identity_verification_guid?: string;
  fiat_account_guid?: string;
  trading_account_guid?: string;
  external_bank_account_guid?: string;
  transfer_guid?: string;
  trade_guid?: string;
  trade_quote_guid?: string;
  funding_quote_guid?: string;
  workflow_guid?: string;
  [key: string]: string | undefined;
}

export interface ActivityItem {
  id: string;
  text: string;
  type: "success" | "error" | "pending";
  time: string;
}

export const STEPS: StepDefinition[] = [
  {
    id: "auth",
    number: 1,
    title: "Authenticate",
    description: "Connect to Cybrid sandbox and obtain an API token.",
  },
  {
    id: "customer",
    number: 2,
    title: "Create Customer",
    description: "Create a regulated customer profile inside Cybrid.",
    prerequisite: "auth",
  },
  {
    id: "kyc",
    number: 3,
    title: "KYC Verification",
    description: "Verify customer identity (sandbox auto-passes).",
    prerequisite: "customer",
  },
  {
    id: "accounts",
    number: 4,
    title: "Create Accounts",
    description: "Create USD fiat account + USDC trading account.",
    prerequisite: "kyc",
  },
  {
    id: "plaid",
    number: 5,
    title: "Link Bank (Plaid)",
    description: "Connect an external bank account via Plaid Link.",
    prerequisite: "accounts",
  },
  {
    id: "fund",
    number: 6,
    title: "Fund (ACH Pull)",
    description: "Pull $10.00 USD from linked bank into Cybrid. In sandbox, this step can be skipped — trades execute without a fiat balance.",
    prerequisite: "plaid",
    skippable: true,
  },
  {
    id: "convert",
    number: 7,
    title: "Convert USD → USDC",
    description: "Get a quote and execute a USD to USDC trade. Sandbox auto-approves even with $0 balance.",
    prerequisite: "plaid",
  },
];
