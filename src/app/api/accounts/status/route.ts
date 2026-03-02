/**
 * GET /api/accounts/status
 *
 * PURPOSE: Check the current state and balance of both accounts.
 *
 * BALANCE UNIT CONVERSIONS:
 *
 *   USD (fiat):
 *     Cybrid stores in cents.
 *     1000 base units = $10.00
 *     Formula: balance / 100
 *
 *   USDC (trading):
 *     Cybrid stores in the smallest USDC unit (8 decimal places).
 *     100_000_000 base units = 1.00000000 USDC
 *     Formula: balance / 100_000_000
 *
 * WHAT YOU SEE WHEN IT WORKS:
 * {
 *   "fiat_account": {
 *     "state": "created",
 *     "asset": "USD",
 *     "balance_raw": 0,
 *     "balance_display": "$0.00"
 *   },
 *   "trading_account": {
 *     "state": "created",
 *     "asset": "USDC",
 *     "balance_raw": 0,
 *     "balance_display": "0.00000000 USDC"
 *   }
 * }
 *
 * After funding (Phase 6), the fiat balance will increase.
 * After trading (Phase 7), the USDC balance will increase.
 *
 * HOW TO TEST:
 *   Open browser: http://localhost:3000/api/accounts/status
 */

import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { NextResponse } from "next/server";

interface CybridAccount {
  guid: string;
  type: string;
  asset: string;
  name: string;
  state: string;
  platform_balance: number;
  platform_available: number;
  customer_guid: string;
}

export async function GET() {
  const fiatGuid = store.get("fiat_account_guid");
  const tradingGuid = store.get("trading_account_guid");

  if (!fiatGuid || !tradingGuid) {
    return NextResponse.json(
      {
        success: false,
        error: "Account GUIDs not found. Run /api/accounts/create first.",
        found: { fiat: !!fiatGuid, trading: !!tradingGuid },
      },
      { status: 400 }
    );
  }

  try {
    // Fetch both accounts in parallel
    const [fiat, trading] = await Promise.all([
      cybridRequest<CybridAccount>(`/api/accounts/${fiatGuid}`),
      cybridRequest<CybridAccount>(`/api/accounts/${tradingGuid}`),
    ]);

    return NextResponse.json({
      success: true,
      fiat_account: {
        guid: fiat.guid,
        type: fiat.type,
        asset: fiat.asset,
        state: fiat.state,
        // Raw value (what Cybrid stores)
        balance_raw: fiat.platform_balance,
        available_raw: fiat.platform_available,
        // Human-readable values
        // USD: divide by 100 (cents → dollars)
        balance_display: `$${(fiat.platform_balance / 100).toFixed(2)}`,
        available_display: `$${(fiat.platform_available / 100).toFixed(2)}`,
      },
      trading_account: {
        guid: trading.guid,
        type: trading.type,
        asset: trading.asset,
        state: trading.state,
        // Raw value
        balance_raw: trading.platform_balance,
        available_raw: trading.platform_available,
        // USDC: divide by 100,000,000 (8 decimal places)
        balance_display: `${(trading.platform_balance / 1e8).toFixed(8)} USDC`,
        available_display: `${(trading.platform_available / 1e8).toFixed(8)} USDC`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
