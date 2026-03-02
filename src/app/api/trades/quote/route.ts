import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteResponse {
  guid: string;
  product_type: string;
  symbol: string;
  side: string;
  receive_amount: number;  // USDC you'll get (in base units: 1 USDC = 100,000,000)
  deliver_amount: number;  // USD you'll spend (in cents: $10 = 1000)
  fee: number;             // fee in cents
  issued_at: string;
  expires_at: string | null;
}

// ─── How much USD we want to convert ─────────────────────────────────────────
const DELIVER_USD_CENTS = 1000; // $10.00

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function handleQuote() {
  const customer_guid = store.get("customer_guid");
  if (!customer_guid) {
    return NextResponse.json(
      { error: "No customer found. Run /api/customer/create first." },
      { status: 400 }
    );
  }

  // 1️⃣  Create a trading quote
  //
  //     A "trading quote" answers the question:
  //     "If I spend exactly $10 USD right now, how much USDC will I receive?"
  //
  //     Cybrid locks in the current market price for you for ~30 seconds.
  //     If you don't execute within that window, the quote expires and you must
  //     request a new one. (Sandbox: 30s. Production: 7s.)
  //
  //     Key fields:
  //       product_type: "trading"  → this is a crypto/fiat swap (not a bank transfer)
  //       symbol: "USDC-USD"       → the trading pair. Format is always "asset-counter_asset"
  //                                  USDC is what we're BUYING, USD is what we're SPENDING
  //       side: "buy"              → we are BUYING the asset (USDC)
  //                                  "sell" would mean selling USDC to receive USD
  //       deliver_amount: 1000     → how much USD we want to SPEND (in cents = $10.00)
  //                                  Cybrid will calculate how much USDC we get back
  //
  //     Why "USDC-USD" and not "USD-USDC"?
  //       Cybrid always formats symbols as "asset-counter_asset".
  //       For a USD→USDC on-ramp, USDC is the asset you're buying,
  //       and USD is the counter currency you're pricing it against.
  //
  //     Why deliver_amount and not receive_amount?
  //       You can specify either:
  //         deliver_amount → "I want to spend exactly $10, give me however much USDC that buys"
  //         receive_amount → "I want exactly 10 USDC, charge me however much USD that costs"
  //       We use deliver_amount because the customer is depositing a fixed dollar amount.

  const quote = await cybridRequest<QuoteResponse>("/api/quotes", {
    method: "POST",
    body: {
      product_type: "trading",
      customer_guid,
      symbol: "USDC-USD",
      side: "buy",
      deliver_amount: DELIVER_USD_CENTS,
    },
  });

  // 2️⃣  Save the quote GUID — the execute route will need it immediately
  store.set("trade_quote_guid", quote.guid);
  console.log(`[trades/quote] Quote created: ${quote.guid}, expires: ${quote.expires_at}`);

  // 3️⃣  Convert amounts to human-readable form for display
  //     USDC base unit = 1e-8 (like satoshis in Bitcoin)
  //     So 1 USDC = 100,000,000 base units
  const usdc_receive = quote.receive_amount / 1e8;
  const usd_deliver = quote.deliver_amount / 100;
  const usd_fee = quote.fee / 100;
  const effective_rate = usdc_receive / usd_deliver; // USDC per USD

  return NextResponse.json({
    quote_guid: quote.guid,
    symbol: quote.symbol,
    side: quote.side,
    you_spend: `$${usd_deliver.toFixed(2)} USD`,
    you_receive: `${usdc_receive.toFixed(8)} USDC`,
    fee: `$${usd_fee.toFixed(2)} USD`,
    effective_rate: `1 USD = ${effective_rate.toFixed(6)} USDC`,
    expires_at: quote.expires_at,
    warning: "⚠️ This quote expires in ~30 seconds. Run /api/trades/execute immediately!",
    next_step: "POST or GET /api/trades/execute to lock in this trade.",
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export async function GET() {
  return handleQuote();
}

export async function POST() {
  return handleQuote();
}
