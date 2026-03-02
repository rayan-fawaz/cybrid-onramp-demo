import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeResponse {
  guid: string;
  symbol: string;
  side: string;
  state: string;
  failure_code: string | null;
  receive_amount: number;
  deliver_amount: number;
  fee: number;
  created_at: string;
  updated_at: string;
}

interface AccountResponse {
  guid: string;
  asset: string;
  type: string;
  state: string;
  platform_balance: number;
  platform_available: number;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET() {
  const trade_guid = store.get("trade_guid");
  const fiat_account_guid = store.get("fiat_account_guid");
  const trading_account_guid = store.get("trading_account_guid");

  if (!trade_guid) {
    return NextResponse.json(
      { error: "No trade found. Run /api/trades/quote then /api/trades/execute first." },
      { status: 400 }
    );
  }

  // Fetch trade + both account balances in parallel — three requests at once
  const [trade, fiatAccount, tradingAccount] = await Promise.all([
    cybridRequest<TradeResponse>(`/api/trades/${trade_guid}`),
    fiat_account_guid
      ? cybridRequest<AccountResponse>(`/api/accounts/${fiat_account_guid}`)
      : Promise.resolve(null),
    trading_account_guid
      ? cybridRequest<AccountResponse>(`/api/accounts/${trading_account_guid}`)
      : Promise.resolve(null),
  ]);

  const usd_spent = trade.deliver_amount / 100;
  const usdc_received = trade.receive_amount / 1e8;
  const fee = trade.fee / 100;

  return NextResponse.json({
    // ── The trade itself ───────────────────────────────────────────────────
    trade: {
      guid: trade_guid,
      symbol: trade.symbol,                         // "USDC-USD"
      side: trade.side,                             // "buy"
      state: trade.state,                           // "settling" in sandbox
      usd_spent: `$${usd_spent.toFixed(2)}`,
      usdc_received: `${usdc_received.toFixed(8)} USDC`,
      fee: `$${fee.toFixed(2)} USD`,
      is_settled: trade.state === "settling" || trade.state === "completed",
      failure_code: trade.failure_code,
    },

    // ── Current account balances ───────────────────────────────────────────
    // These reflect the result of the trade.
    // USD should have decreased. USDC should have increased.
    accounts: {
      fiat_usd: fiatAccount
        ? {
            guid: fiat_account_guid,
            balance: `$${(fiatAccount.platform_balance / 100).toFixed(2)} USD`,
            available: `$${(fiatAccount.platform_available / 100).toFixed(2)} USD`,
          }
        : null,
      trading_usdc: tradingAccount
        ? {
            guid: trading_account_guid,
            balance: `${(tradingAccount.platform_balance / 1e8).toFixed(8)} USDC`,
            available: `${(tradingAccount.platform_available / 1e8).toFixed(8)} USDC`,
          }
        : null,
    },

    // ── Summary ────────────────────────────────────────────────────────────
    on_ramp_complete:
      trade.state === "settling" || trade.state === "completed",
    message:
      trade.state === "settling" || trade.state === "completed"
        ? `🎉 On-ramp complete! $${usd_spent.toFixed(2)} USD was converted to ${usdc_received.toFixed(8)} USDC.`
        : trade.state === "failed"
        ? `Trade failed: ${trade.failure_code}`
        : `Trade is still processing (state: ${trade.state}). Check again shortly.`,
    sandbox_note:
      "'settling' is the terminal success state in sandbox. Production would show 'completed' after real on-chain settlement.",
  });
}
