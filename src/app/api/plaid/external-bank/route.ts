import { NextRequest, NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExternalBankAccountResponse {
  guid: string;
  name: string;
  asset: string;
  account_kind: string;
  state:
    | "storing"
    | "completed"
    | "unverified"
    | "failed"
    | "refresh_required"
    | "deleting"
    | "deleted";
  failure_code: string | null;
  plaid_institution_id: string | null;
  plaid_account_mask: string | null;
  plaid_account_name: string | null;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function handleCreate(plaid_public_token: string, plaid_account_id: string) {
  // 1️⃣  Read customer GUID
  const customer_guid = store.get("customer_guid");
  if (!customer_guid) {
    return NextResponse.json(
      { error: "No customer found. Run /api/customer/create first." },
      { status: 400 }
    );
  }

  // 2️⃣  Exchange the Plaid public_token for a Cybrid external bank account.
  //
  //     What just happened in the browser:
  //       - The user selected their bank and logged in inside the Plaid widget
  //       - Plaid called our onSuccess(public_token, metadata) callback
  //       - public_token is a ONE-TIME-USE token that expires in 30 minutes
  //       - plaid_account_id identifies the specific bank account the user chose
  //
  //     We now hand both to Cybrid, which uses them to create a reusable
  //     processor token behind the scenes (ACH-capable link between us and the bank).
  //
  //     Required fields (from spec):
  //       name            → human label for this bank account
  //       account_kind    → "plaid" (tells Cybrid this came from Plaid Link)
  //       plaid_public_token  → the one-time token from Plaid onSuccess
  //       plaid_account_id   → which account within that bank
  //       customer_guid   → who owns this external account
  //       asset           → currency of this account ("USD")
  const account = await cybridRequest<ExternalBankAccountResponse>(
    "/api/external_bank_accounts",
    {
      method: "POST",
      body: {
        name: "My Linked Bank Account",
        account_kind: "plaid",
        customer_guid,
        asset: "USD",
        plaid_public_token,
        plaid_account_id,
      },
    }
  );

  const account_guid = account.guid;
  console.log(`[plaid/external-bank] Created external bank account ${account_guid}, state: ${account.state}`);

  // 3️⃣  Save for later phases (ACH transfer in Phase 6 will need this GUID)
  store.set("external_bank_account_guid", account_guid);

  // 4️⃣  Poll until the account moves out of "storing".
  //     Most transitions happen in < 5 seconds in the sandbox.
  //
  //     Possible terminal states:
  //       "completed"        → ready to use for ACH transfers ✅
  //       "unverified"       → linked but not yet micro-deposit verified (rare in sandbox)
  //       "failed"           → something went wrong (bad token, duplicate, etc.) ❌
  //       "refresh_required" → token expired; must re-run Plaid Link in update mode ⚠️
  const final = await poll<ExternalBankAccountResponse>(
    () => cybridRequest<ExternalBankAccountResponse>(`/api/external_bank_accounts/${account_guid}`),
    (a) => a.state !== "storing",
    { intervalMs: 1500, timeoutMs: 30000, label: "external_bank_account" }
  );

  // 5️⃣  Handle each outcome
  if (final.state === "failed") {
    return NextResponse.json(
      {
        error: "External bank account creation failed",
        failure_code: final.failure_code,
        hint:
          final.failure_code === "plaid_processor_token"
            ? "The Plaid public token was invalid or already used."
            : final.failure_code === "plaid_multiple_accounts"
            ? "The user selected multiple accounts — only one is allowed."
            : "Check the failure_code for details.",
      },
      { status: 500 }
    );
  }

  if (final.state === "refresh_required") {
    // The bank token has expired. The user needs to re-authenticate via Plaid.
    // To do this: create a new workflow with kind = "link_token_update" + external_bank_account_guid,
    // then open Plaid Link again in update mode. The user re-authenticates without re-selecting their bank.
    return NextResponse.json(
      {
        error: "Bank connection requires re-authentication",
        state: "refresh_required",
        external_bank_account_guid: account_guid,
        hint: "Call /api/plaid/refresh with the external_bank_account_guid to get an update token.",
      },
      { status: 428 } // 428 Precondition Required — semantically fits "you must do X first"
    );
  }

  // 6️⃣  Success — return account details
  return NextResponse.json({
    external_bank_account_guid: account_guid,
    name: final.plaid_account_name ?? "Bank Account",
    mask: final.plaid_account_mask ? `****${final.plaid_account_mask}` : null,
    institution: final.plaid_institution_id,
    asset: final.asset,
    state: final.state,
    message:
      final.state === "completed"
        ? "Bank account linked successfully! Ready for ACH funding."
        : `Bank account is in state: ${final.state}`,
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { plaid_public_token?: string; plaid_account_id?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { plaid_public_token, plaid_account_id } = body;

  if (!plaid_public_token || !plaid_account_id) {
    return NextResponse.json(
      { error: "Both plaid_public_token and plaid_account_id are required" },
      { status: 400 }
    );
  }

  return handleCreate(plaid_public_token, plaid_account_id);
}

// ─── GET: Check status of the saved external bank account ────────────────────

export async function GET() {
  const account_guid = store.get("external_bank_account_guid");

  if (!account_guid) {
    return NextResponse.json(
      { error: "No external bank account found. Complete Phase 5 (Plaid link) first." },
      { status: 400 }
    );
  }

  const account = await cybridRequest<ExternalBankAccountResponse>(
    `/api/external_bank_accounts/${account_guid}`
  );

  return NextResponse.json({
    external_bank_account_guid: account_guid,
    name: account.plaid_account_name ?? "Bank Account",
    mask: account.plaid_account_mask ? `****${account.plaid_account_mask}` : null,
    institution: account.plaid_institution_id,
    asset: account.asset,
    state: account.state,
    is_ready: account.state === "completed",
    next_step:
      account.state === "completed"
        ? "Ready for ACH funding → /api/transfers/create"
        : account.state === "unverified"
        ? "Account needs verification. See instructions below."
        : account.state === "refresh_required"
        ? "Re-run Phase 5 (Plaid link) to reconnect."
        : `State is '${account.state}' — check back shortly.`,
    verification_note:
      account.state === "unverified"
        ? "In production this requires micro-deposit verification. In sandbox: go back to /plaid, re-link using a US test bank (search 'Tartan Bank' or 'First Platypus'), and use user_good / pass_good."
        : null,
  });
}
