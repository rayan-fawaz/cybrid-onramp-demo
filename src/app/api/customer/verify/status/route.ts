/**
 * GET /api/customer/verify/status
 *
 * PURPOSE: Check the current state of an identity verification (and the customer).
 *
 * WHEN TO USE THIS:
 * - After calling /api/customer/verify/start, use this to check progress
 * - Useful if you want to build a "Refresh" button in the UI
 * - Also confirms the customer's own state (unverified → verified)
 *
 * WHAT IT RETURNS:
 * {
 *   "verification": {
 *     "guid": "...",
 *     "state": "completed",    ← storing/waiting/pending/reviewing/expired/completed
 *     "outcome": "passed"      ← null (in progress) | "passed" | "failed"
 *   },
 *   "customer": {
 *     "guid": "...",
 *     "state": "verified"      ← unverified | verified | rejected | frozen
 *   },
 *   "is_verified": true        ← convenience flag: true when you're ready for next step
 * }
 *
 * HOW TO TEST:
 *   Open browser: http://localhost:3000/api/customer/verify/status
 */

import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { NextResponse } from "next/server";

interface IdentityVerification {
  guid: string;
  state: string;
  outcome: string | null;
  failure_codes: string[] | null;
}

interface CybridCustomer {
  guid: string;
  state: string;
}

export async function GET() {
  // ── Read saved GUIDs from our database ──
  const customerGuid = store.get("customer_guid");
  const verificationGuid = store.get("identity_verification_guid");

  if (!customerGuid) {
    return NextResponse.json(
      { success: false, error: "No customer_guid found. Run /api/customer/create first." },
      { status: 400 }
    );
  }

  if (!verificationGuid) {
    return NextResponse.json(
      { success: false, error: "No identity_verification_guid found. Run /api/customer/verify/start first." },
      { status: 400 }
    );
  }

  try {
    // Fetch both in parallel — no reason to wait for one before the other
    const [verification, customer] = await Promise.all([
      cybridRequest<IdentityVerification>(`/api/identity_verifications/${verificationGuid}`),
      cybridRequest<CybridCustomer>(`/api/customers/${customerGuid}`),
    ]);

    const isVerified = verification.state === "completed" &&
                       verification.outcome === "passed" &&
                       customer.state === "verified";

    return NextResponse.json({
      success: true,
      is_verified: isVerified,
      verification: {
        guid: verification.guid,
        state: verification.state,
        outcome: verification.outcome,
        failure_codes: verification.failure_codes,
      },
      customer: {
        guid: customer.guid,
        state: customer.state,
      },
      next_step: isVerified
        ? "✅ Ready! You can now create accounts → /api/accounts/create"
        : "⏳ Not yet verified. Check state above.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
