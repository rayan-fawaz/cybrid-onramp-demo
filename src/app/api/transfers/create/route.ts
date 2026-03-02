import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteResponse {
  guid: string;
  product_type: string;
  side: string;
  asset: string;
  receive_amount: number;
  deliver_amount: number;
  fee: number;
}

interface TransferResponse {
  guid: string;
  transfer_type: string;
  state: "storing" | "reviewing" | "pending" | "holding" | "completed" | "failed";
  failure_code: string | null;
  amount: number | null;
  estimated_amount: number;
  fee: number;
  payment_rail: string | null;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

// Amount to fund — $10.00 in cents (USD is always in base units = cents)
const FUND_AMOUNT_CENTS = 1000;

async function handleCreate() {
  // 1️⃣  Read all the GUIDs we saved in previous phases
  const customer_guid = store.get("customer_guid");
  const fiat_account_guid = store.get("fiat_account_guid");
  const external_bank_account_guid = store.get("external_bank_account_guid");

  if (!customer_guid || !fiat_account_guid || !external_bank_account_guid) {
    return NextResponse.json(
      {
        error: "Missing required GUIDs. Complete Phase 2 (customer), Phase 4 (accounts), and Phase 5 (Plaid link) first.",
        missing: {
          customer_guid: !customer_guid,
          fiat_account_guid: !fiat_account_guid,
          external_bank_account_guid: !external_bank_account_guid,
        },
      },
      { status: 400 }
    );
  }

  // 2️⃣  Step A — Create a Quote
  //
  //     Think of a quote like a price agreement slip at a currency exchange desk:
  //     "I want to deposit $10 USD. Here's what it'll cost."
  //     The quote locks in the amount and any fees for a short window.
  //     You MUST create a quote before you can create a transfer.
  //
  //     Key fields:
  //       product_type: "funding"  → this is a bank deposit/withdrawal (not a crypto trade)
  //       side: "deposit"          → money is coming IN to Cybrid (vs. "withdrawal" = going out)
  //       asset: "USD"             → the currency being funded
  //       receive_amount: 1000     → how much lands in the Cybrid fiat account (in cents = $10.00)
  //       customer_guid            → who this quote belongs to
  console.log(`[transfers/create] Creating funding quote for $${FUND_AMOUNT_CENTS / 100} USD...`);

  const quote = await cybridRequest<QuoteResponse>("/api/quotes", {
    method: "POST",
    body: {
      product_type: "funding",
      customer_guid,
      asset: "USD",
      side: "deposit",
      receive_amount: FUND_AMOUNT_CENTS,
    },
  });

  const quote_guid = quote.guid;
  store.set("funding_quote_guid", quote_guid);
  console.log(`[transfers/create] Quote created: ${quote_guid}, fee: ${quote.fee} cents`);

  // 3️⃣  Step B — Create the Transfer
  //
  //     Requires the external bank account to be in state "completed" (fully verified).
  //
  //     ── Sandbox limitation for Canadian users ────────────────────────────────
  //     If you linked a Canadian bank (Scotiabank, Tartan-Dominion, etc.), the
  //     account will be "unverified" because Canadian banks don't support Plaid Auth
  //     (instant verification). This blocks ACH/EFT funding.
  //
  //     Fix: In the Plaid widget (/plaid), search "Platypus" → link "First Platypus
  //     Bank" (ins_109508). It's Plaid's official US sandbox test institution that
  //     verifies instantly and returns state: "completed".
  //
  //     Alternative: Go straight to Phase 7 (/api/trades/create). The Cybrid sandbox
  //     auto-funds trade executions even with $0 fiat balance.

  // Check external bank account state before attempting the transfer
  let externalBankAccountState = "unknown";
  try {
    const acct = await cybridRequest<{ state: string }>(
      `/api/external_bank_accounts/${external_bank_account_guid}`
    );
    externalBankAccountState = acct.state;
  } catch {
    // ignore — state stays "unknown"
  }

  console.log(`[transfers/create] External bank account state: ${externalBankAccountState}`);

  if (externalBankAccountState !== "completed") {
    return NextResponse.json(
      {
        error: "External bank account is not verified",
        state: externalBankAccountState,
        external_bank_account_guid,
        why: "Cybrid requires 'completed' state before ACH/EFT transfers can execute.",
        fix_option_1:
          "In the Plaid widget (/plaid), search 'Platypus' and link 'First Platypus Bank'. It's a US sandbox institution that verifies instantly.",
        fix_option_2:
          "Skip to Phase 7: the sandbox auto-funds trades. Go to /api/trades/create.",
      },
      { status: 422 }
    );
  }

  console.log(`[transfers/create] Creating funding transfer...`);

  const transferBody: Record<string, unknown> = {
    quote_guid,
    transfer_type: "funding",
    external_bank_account_guid,
    source_participants: [
      { type: "customer", amount: FUND_AMOUNT_CENTS, guid: customer_guid },
    ],
    destination_participants: [
      { type: "customer", amount: FUND_AMOUNT_CENTS, guid: customer_guid },
    ],
  };

  const transfer = await cybridRequest<TransferResponse>("/api/transfers", {
    method: "POST",
    body: transferBody,
  });

  const transfer_guid = transfer.guid;
  store.set("transfer_guid", transfer_guid);
  console.log(`[transfers/create] Transfer created: ${transfer_guid}, initial state: ${transfer.state}`);

  // 4️⃣  Poll until the transfer reaches a terminal state.
  //
  //     Transfer lifecycle in sandbox:
  //       storing   → Cybrid is recording the intent (< 1 second)
  //       reviewing → Cybrid is running compliance checks (rare in sandbox)
  //       pending   → Cybrid is executing the ACH pull with the bank
  //       completed → Money has landed in the fiat account ✅
  //       failed    → Something went wrong ❌
  //
  //     In sandbox this typically goes: storing → pending → completed in ~5-10 seconds.
  const completed = await poll<TransferResponse>(
    () => cybridRequest<TransferResponse>(`/api/transfers/${transfer_guid}`),
    (t) => t.state === "completed" || t.state === "failed",
    { intervalMs: 2000, timeoutMs: 60000, label: "transfer" }
  );

  // 5️⃣  Handle failure
  if (completed.state === "failed") {
    return NextResponse.json(
      {
        error: "Transfer failed",
        failure_code: completed.failure_code,
        hint: getFailureHint(completed.failure_code),
      },
      { status: 500 }
    );
  }

  // 6️⃣  Success — return the result
  const actualAmount = completed.amount ?? completed.estimated_amount;

  return NextResponse.json({
    transfer_guid,
    quote_guid,
    state: completed.state,
    amount_usd: `$${(actualAmount / 100).toFixed(2)}`,
    fee_usd: `$${(completed.fee / 100).toFixed(2)}`,
    payment_rail: completed.payment_rail,
    message: `✅ ACH deposit of $${(actualAmount / 100).toFixed(2)} completed. Check /api/transfers/status or /api/accounts/status for updated balance.`,
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getFailureHint(code: string | null): string {
  const hints: Record<string, string> = {
    non_sufficient_funds: "The external bank account doesn't have enough funds.",
    refresh_required: "The Plaid bank connection expired. Re-run Phase 5 to reconnect.",
    party_name_invalid: "The bank account holder name doesn't match the customer.",
    payment_rail_invalid: "ACH is not supported for this external bank account.",
    compliance_rejection: "The transfer was blocked by compliance checks.",
    limit_exceeded: "The customer has exceeded their transfer limits.",
    amount_too_low: "The transfer amount is below the minimum allowed.",
    plaid_access_not_granted: "Plaid access was revoked. Re-run Phase 5 to reconnect.",
  };
  return hints[code ?? ""] ?? `Unexpected failure. Check failure_code: ${code}`;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export async function GET() {
  return handleCreate();
}

export async function POST() {
  return handleCreate();
}
