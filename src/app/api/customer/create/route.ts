/**
 * POST /api/customer/create
 *
 * PURPOSE: Create a new individual customer on Cybrid.
 *
 * WHAT IT DOES:
 * 1. Calls Cybrid's POST /api/customers with { type: "individual" }
 * 2. Saves the returned customer_guid in our SQLite database
 * 3. Returns the full customer object
 *
 * WHAT YOU GET BACK FROM CYBRID:
 * {
 *   "guid": "abc123...",        ← the customer's unique ID (we save this)
 *   "bank_guid": "fba0c...",    ← your bank's ID
 *   "type": "individual",
 *   "state": "storing",         ← will change to "unverified" in ~1 second
 *   "created_at": "2026-..."
 * }
 *
 * CUSTOMER STATES:
 *   storing    → Cybrid is saving the record (takes ~1 second)
 *   unverified → Saved! But hasn't passed KYC yet (next step)
 *   verified   → Passed KYC — can now create accounts
 *   rejected   → KYC failed
 *   frozen     → Account frozen
 *
 * HOW TO TEST:
 *   Open browser: http://localhost:3000/api/customer/create
 *   (It's a POST, so use the browser button or curl — see below)
 *
 *   curl -X POST http://localhost:3000/api/customer/create
 */

import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { NextResponse } from "next/server";

// The shape of what Cybrid returns when you create a customer
interface CybridCustomer {
  guid: string;
  bank_guid: string;
  type: string;
  state: string;
  created_at: string;
}

// Allow GET too so you can test from the browser URL bar
// (browsers can only do GET — POST requires curl or code)
export async function GET() {
  return handleCreate();
}

export async function POST() {
  return handleCreate();
}

async function handleCreate() {
  try {
    // ── Step 1: Create the customer on Cybrid ──
    // This sends: POST https://bank.sandbox.cybrid.app/api/customers
    // With body:  { "type": "individual" }
    const customer = await cybridRequest<CybridCustomer>("/api/customers", {
      method: "POST",
      body: { type: "individual" },
    });

    // ── Step 2: Save the GUID in our local database ──
    // We'll need this for EVERY future step (verify, create accounts, etc.)
    store.set("customer_guid", customer.guid);

    // ── Step 3: Return the result ──
    return NextResponse.json({
      success: true,
      message: `✅ Customer created! State: ${customer.state}`,
      customer,
      saved_guid: customer.guid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
