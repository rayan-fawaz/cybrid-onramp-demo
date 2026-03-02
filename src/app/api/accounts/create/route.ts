/**
 * GET /api/accounts/create
 *
 * PURPOSE: Create two accounts for the verified customer:
 *   1. A FIAT account   (type: "fiat",    asset: "USD")  — holds US dollars
 *   2. A TRADING account (type: "trading", asset: "USDC") — holds USDC stablecoin
 *
 * CONCEPTUALLY:
 *   Think of these as two separate "balance buckets":
 *
 *   ┌─────────────────────────┐    ┌──────────────────────────────┐
 *   │  Fiat Account (USD)     │    │  Trading Account (USDC)      │
 *   │  Like a checking account│    │  Like a crypto wallet        │
 *   │  Balance: $0.00         │    │  Balance: 0.00 USDC          │
 *   └─────────────────────────┘    └──────────────────────────────┘
 *
 *   Money flows:
 *   External Bank ──ACH──► Fiat Account ──Trade──► Trading Account
 *
 * BALANCE UNITS (important!):
 *   Cybrid stores ALL balances in "base units":
 *   - USD: base unit = cents  →  1000 = $10.00
 *   - USDC: base unit = the smallest USDC unit (like satoshis for BTC)
 *             1 USDC = 100,000,000 base units (8 decimal places)
 *   We'll display human-readable amounts in the status route.
 *
 * STATES:
 *   storing → created   (same async pattern as everything else)
 *
 * HOW TO TEST:
 *   Open browser: http://localhost:3000/api/accounts/create
 *   (Must have run /api/customer/verify/start first!)
 */

import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";
import { NextResponse } from "next/server";

// Shape of an account returned by Cybrid
interface CybridAccount {
  guid: string;
  type: string;           // "fiat" or "trading"
  asset: string;          // "USD" or "USDC"
  name: string;
  state: string;          // "storing" | "created"
  platform_balance: number;    // balance in base units
  platform_available: number;  // available balance in base units
  customer_guid: string;
  bank_guid: string;
}

// Allow GET so you can trigger it from the browser
export async function GET() {
  return handleCreateAccounts();
}

export async function POST() {
  return handleCreateAccounts();
}

async function handleCreateAccounts() {
  // ── Guard: must have a verified customer first ──
  const customerGuid = store.get("customer_guid");
  if (!customerGuid) {
    return NextResponse.json(
      { success: false, error: "No customer_guid found. Run /api/customer/create first." },
      { status: 400 }
    );
  }

  try {
    // ── Step 1: Create BOTH accounts in parallel ──
    // No reason to wait for one before starting the other — they're independent.
    // Promise.all() fires both requests at the same time and waits for both to finish.
    console.log(`\n🏦 Creating fiat (USD) and trading (USDC) accounts for customer: ${customerGuid}`);

    const [fiatAccount, tradingAccount] = await Promise.all([
      cybridRequest<CybridAccount>("/api/accounts", {
        method: "POST",
        body: {
          type: "fiat",
          asset: "USD",
          name: "Customer USD Fiat Account",
          customer_guid: customerGuid,
        },
      }),
      cybridRequest<CybridAccount>("/api/accounts", {
        method: "POST",
        body: {
          type: "trading",
          asset: "USDC",
          name: "Customer USDC Trading Account",
          customer_guid: customerGuid,
        },
      }),
    ]);

    console.log(`💾 Fiat account created: ${fiatAccount.guid} (state: ${fiatAccount.state})`);
    console.log(`💾 Trading account created: ${tradingAccount.guid} (state: ${tradingAccount.state})`);

    // ── Step 2: Save the GUIDs immediately (even before they're "created") ──
    store.set("fiat_account_guid", fiatAccount.guid);
    store.set("trading_account_guid", tradingAccount.guid);

    // ── Step 3: Poll both accounts until they reach state: "created" ──
    // We poll them in parallel too — no point waiting for one at a time.
    console.log(`\n⏳ Waiting for both accounts to reach state: "created"...`);

    const [confirmedFiat, confirmedTrading] = await Promise.all([
      poll(
        () => cybridRequest<CybridAccount>(`/api/accounts/${fiatAccount.guid}`),
        (acc) => acc.state === "created",
        { intervalMs: 1500, timeoutMs: 30000, label: "fiat_account" }
      ),
      poll(
        () => cybridRequest<CybridAccount>(`/api/accounts/${tradingAccount.guid}`),
        (acc) => acc.state === "created",
        { intervalMs: 1500, timeoutMs: 30000, label: "trading_account" }
      ),
    ]);

    return NextResponse.json({
      success: true,
      message: "✅ Both accounts created successfully!",
      fiat_account: {
        guid: confirmedFiat.guid,
        type: confirmedFiat.type,
        asset: confirmedFiat.asset,
        state: confirmedFiat.state,
        balance_usd: (confirmedFiat.platform_balance / 100).toFixed(2),  // cents → dollars
      },
      trading_account: {
        guid: confirmedTrading.guid,
        type: confirmedTrading.type,
        asset: confirmedTrading.asset,
        state: confirmedTrading.state,
        // USDC has 8 decimal places (like BTC base units)
        balance_usdc: (confirmedTrading.platform_balance / 1e8).toFixed(8),
      },
      next_step: "➡️ Link a bank account → /api/plaid/workflow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
