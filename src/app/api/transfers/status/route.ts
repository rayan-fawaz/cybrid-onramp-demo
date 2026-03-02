import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransferResponse {
  guid: string;
  transfer_type: string;
  state: string;
  failure_code: string | null;
  amount: number | null;
  estimated_amount: number;
  fee: number;
  payment_rail: string | null;
  created_at: string;
  updated_at: string;
}

interface AccountResponse {
  guid: string;
  asset: string;
  state: string;
  platform_balance: number;
  platform_available: number;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET() {
  const transfer_guid = store.get("transfer_guid");
  const fiat_account_guid = store.get("fiat_account_guid");

  if (!transfer_guid) {
    return NextResponse.json(
      { error: "No transfer found. Run /api/transfers/create first." },
      { status: 400 }
    );
  }

  // Fetch transfer state + fiat balance in parallel
  const [transfer, fiatAccount] = await Promise.all([
    cybridRequest<TransferResponse>(`/api/transfers/${transfer_guid}`),
    fiat_account_guid
      ? cybridRequest<AccountResponse>(`/api/accounts/${fiat_account_guid}`)
      : Promise.resolve(null),
  ]);

  const amount = transfer.amount ?? transfer.estimated_amount;

  return NextResponse.json({
    transfer: {
      guid: transfer_guid,
      state: transfer.state,
      failure_code: transfer.failure_code,
      amount_usd: `$${(amount / 100).toFixed(2)}`,
      fee_usd: `$${(transfer.fee / 100).toFixed(2)}`,
      payment_rail: transfer.payment_rail,
      created_at: transfer.created_at,
      updated_at: transfer.updated_at,
    },
    fiat_account: fiatAccount
      ? {
          guid: fiat_account_guid,
          asset: fiatAccount.asset,
          state: fiatAccount.state,
          balance: `$${(fiatAccount.platform_balance / 100).toFixed(2)}`,
          available: `$${(fiatAccount.platform_available / 100).toFixed(2)}`,
        }
      : null,
    is_complete: transfer.state === "completed",
    next_step:
      transfer.state === "completed"
        ? "Phase 7 ready: go to /api/trades/create to swap USD → USDC"
        : transfer.state === "failed"
        ? `Transfer failed (${transfer.failure_code}). Check /api/transfers/create to retry.`
        : `Transfer is ${transfer.state} — check again in a few seconds.`,
  });
}
