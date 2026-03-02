/**
 * GET /api/customer/verify/start
 *
 * PURPOSE: Start KYC (Know Your Customer) identity verification for the customer.
 *
 * WHAT IS KYC?
 * Before a customer can create accounts or move money, they must prove they are
 * who they say they are. In real life this means uploading a passport + selfie.
 * In sandbox, we skip all that with the "passed_immediately" magic flag.
 *
 * WHAT THIS DOES:
 * 1. Reads customer_guid from SQLite (saved in the "create customer" step)
 * 2. Calls POST /api/identity_verifications on Cybrid
 * 3. Saves the identity_verification_guid to SQLite
 * 4. Polls until the verification reaches state: "completed", outcome: "passed"
 * 5. Confirms the customer themselves now shows state: "verified"
 *
 * THE SANDBOX SHORTCUT:
 * In production, the customer would go through a real document + selfie flow.
 * In sandbox, "expected_behaviours: ['passed_immediately']" tells Cybrid to
 * skip all that and just mark it as passed. This only works in sandbox.
 *
 * STATES THE VERIFICATION GOES THROUGH:
 *   storing → waiting → pending → reviewing → completed (outcome: passed ✅)
 *
 * HOW TO TEST:
 *   Open browser: http://localhost:3000/api/customer/verify/start
 *   (Must have run /api/customer/create first!)
 */

import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";
import { NextResponse } from "next/server";

// Shape of an identity verification returned by Cybrid
interface IdentityVerification {
  guid: string;
  type: string;
  method: string;
  customer_guid: string;
  state: string;               // storing | waiting | pending | reviewing | expired | completed
  outcome: string | null;      // null until completed, then "passed" or "failed"
  failure_codes: string[] | null;
  created_at: string;
}

// Shape of a customer (to confirm they become "verified")
interface CybridCustomer {
  guid: string;
  state: string;   // unverified | verified | rejected | frozen
}

// Allow GET so you can trigger it from the browser URL bar
export async function GET() {
  return handleVerifyStart();
}

export async function POST() {
  return handleVerifyStart();
}

async function handleVerifyStart() {
  // ── Step 1: Get the customer GUID we saved earlier ──
  const customerGuid = store.get("customer_guid");
  if (!customerGuid) {
    return NextResponse.json(
      {
        success: false,
        error: "No customer_guid found in database. Did you run /api/customer/create first?",
      },
      { status: 400 }
    );
  }

  try {
    // ── Step 2: Start identity verification on Cybrid ──
    //
    // KEY FIELDS EXPLAINED:
    // - type: "kyc"                              → Know Your Customer check (vs bank_account or counterparty)
    // - method: "id_and_selfie"                  → govt ID + selfie (the standard individual KYC method)
    // - customer_guid                            → which customer to verify
    // - expected_behaviours: ["passed_immediately"] → SANDBOX ONLY: skip the real flow, just pass
    //
    console.log(`\n🆔 Starting KYC for customer: ${customerGuid}`);

    const verification = await cybridRequest<IdentityVerification>(
      "/api/identity_verifications",
      {
        method: "POST",
        body: {
          type: "kyc",
          method: "id_and_selfie",
          customer_guid: customerGuid,
          expected_behaviours: ["passed_immediately"],
        },
      }
    );

    // ── Step 3: Save the verification GUID ──
    store.set("identity_verification_guid", verification.guid);
    console.log(`💾 Saved identity_verification_guid: ${verification.guid}`);

    // ── Step 4: Poll until verification is completed ──
    //
    // Even with "passed_immediately", there's a short async delay.
    // We poll every 1.5 seconds, up to 30 seconds.
    //
    console.log(`\n⏳ Polling until verification completes...`);
    const completed = await poll(
      () =>
        cybridRequest<IdentityVerification>(
          `/api/identity_verifications/${verification.guid}`
        ),
      (v) => v.state === "completed",
      { intervalMs: 1500, timeoutMs: 30000, label: "identity_verification" }
    );

    // ── Step 5: Confirm the customer is now "verified" ──
    const customer = await cybridRequest<CybridCustomer>(
      `/api/customers/${customerGuid}`
    );

    return NextResponse.json({
      success: true,
      message: `✅ KYC complete! Outcome: ${completed.outcome} | Customer state: ${customer.state}`,
      verification: {
        guid: completed.guid,
        state: completed.state,
        outcome: completed.outcome,
      },
      customer: {
        guid: customer.guid,
        state: customer.state,
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
