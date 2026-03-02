import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeResponse {
  guid: string;
  trade_type: string;
  customer_guid: string;
  quote_guid: string;
  symbol: string;
  side: string;
  state:
    | "storing"
    | "pending"
    | "executed"
    | "settling"
    | "cancelled"
    | "completed"
    | "failed";
  failure_code: string | null;
  receive_amount: number;
  deliver_amount: number;
  fee: number;
  created_at: string;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function handleExecute() {
  // 1️⃣  Read the quote GUID saved by /api/trades/quote
  const quote_guid = store.get("trade_quote_guid");
  const customer_guid = store.get("customer_guid");

  if (!quote_guid) {
    return NextResponse.json(
      { error: "No quote found. Run /api/trades/quote first (you have ~30 seconds to execute it)." },
      { status: 400 }
    );
  }

  // 2️⃣  Execute the trade
  //
  //     This is the simplest API call in the whole project — just one required field.
  //     The quote already contains everything Cybrid needs: symbol, side, amount, price.
  //     The trade just says "do it."
  //
  //     What happens under the hood:
  //       a) Cybrid debits the deliver_amount (USD) from the customer's fiat account
  //       b) Cybrid credits the receive_amount (USDC) to the customer's trading account
  //       c) In production: Cybrid settles with real liquidity providers on-chain
  //       d) In sandbox: Cybrid simulates both sides — no real money or tokens move
  //
  //     One important difference from transfers:
  //       We do NOT specify source/destination accounts here.
  //       Cybrid already knows from the quote + customer that:
  //         source = customer's fiat account (USD)
  //         destination = customer's trading account (USDC)
  //       It pairs them automatically based on asset type.
  console.log(`[trades/execute] Executing trade for quote ${quote_guid}...`);

  const trade = await cybridRequest<TradeResponse>("/api/trades", {
    method: "POST",
    body: {
      quote_guid,
    },
  });

  const trade_guid = trade.guid;
  store.set("trade_guid", trade_guid);
  console.log(`[trades/execute] Trade created: ${trade_guid}, state: ${trade.state}`);

  // 3️⃣  Poll until the trade reaches a terminal state
  //
  //     Trade lifecycle:
  //       storing  → Cybrid is recording the trade
  //       pending  → Cybrid is processing it
  //       executed → Price locked in, waiting to settle
  //       settling → Funds are moving between accounts ← TERMINAL in sandbox
  //       completed → Fully settled (only happens in production)
  //       failed   → Something went wrong
  //
  //     ⚠️ Sandbox-specific behaviour:
  //       In sandbox, trades NEVER reach "completed". They stop at "settling".
  //       This is because Cybrid's sandbox doesn't connect to real liquidity providers
  //       for final on-chain settlement. "settling" means the trade executed correctly
  //       and the balances have already updated — treat it as success.
  //
  //     From the Cybrid docs:
  //       "Trades will remain in the settling state and will not transition to completed.
  //        Because our liquidity providers do not support trades on testnets, we cannot
  //        perform the final on-chain settlement."
  const final = await poll<TradeResponse>(
    () => cybridRequest<TradeResponse>(`/api/trades/${trade_guid}`),
    (t) =>
      t.state === "settling" ||
      t.state === "completed" ||
      t.state === "failed" ||
      t.state === "cancelled",
    { intervalMs: 1500, timeoutMs: 30000, label: "trade" }
  );

  // 4️⃣  Handle failure
  if (final.state === "failed" || final.state === "cancelled") {
    const hints: Record<string, string> = {
      non_sufficient_funds:
        "Not enough USD in the fiat account. In sandbox this shouldn't happen — contact Cybrid support.",
      expired_quote:
        "The quote expired before the trade executed. Run /api/trades/quote again and execute within 30 seconds.",
      unsupported: "This trading pair is not enabled for this customer.",
      limit_exceeded: "The customer has exceeded their daily/weekly trading limits.",
      market_volatility:
        "The price moved too much between quote and execution. Try again.",
    };

    return NextResponse.json(
      {
        error: `Trade ${final.state}`,
        failure_code: final.failure_code,
        hint: hints[final.failure_code ?? ""] ?? `Unexpected failure: ${final.failure_code}`,
      },
      { status: 500 }
    );
  }

  // 5️⃣  Success — trade is settling (sandbox terminal state)
  const usdc_received = final.receive_amount / 1e8;
  const usd_delivered = final.deliver_amount / 100;
  const usd_fee = final.fee / 100;

  return NextResponse.json({
    trade_guid,
    quote_guid,
    symbol: final.symbol,
    side: final.side,
    state: final.state,
    usd_spent: `$${usd_delivered.toFixed(2)}`,
    usdc_received: `${usdc_received.toFixed(8)} USDC`,
    fee: `$${usd_fee.toFixed(2)} USD`,
    is_success: true,
    sandbox_note:
      final.state === "settling"
        ? "State is 'settling' — this is the terminal success state in sandbox. In production this would continue to 'completed' after on-chain settlement."
        : null,
    message: `✅ On-ramp complete! Converted $${usd_delivered.toFixed(2)} USD → ${usdc_received.toFixed(8)} USDC`,
    next_step: "Check /api/trades/status to see updated balances on both accounts.",
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export async function GET() {
  return handleExecute();
}

export async function POST() {
  return handleExecute();
}
