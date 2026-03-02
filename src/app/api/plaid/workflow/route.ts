import { NextResponse } from "next/server";
import { cybridRequest } from "@/lib/cybrid-client";
import { store } from "@/lib/db";
import { poll } from "@/lib/poll";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowResponse {
  guid: string;
  state: "storing" | "completed" | "failed";
  failure_code: string | null;
  plaid_link_token: string | null; // only present on the GET (WorkflowWithDetails)
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function handleWorkflow() {
  // 1️⃣  Read the customer GUID we saved back in Phase 2
  const customer_guid = store.get("customer_guid");
  if (!customer_guid) {
    return NextResponse.json(
      { error: "No customer found. Run /api/customer/create first." },
      { status: 400 }
    );
  }

  // 2️⃣  Ask Cybrid to create a Plaid "link_token_create" workflow.
  //     This tells Cybrid: "I want to start a Plaid Link session for this customer."
  //     Cybrid will talk to Plaid on our behalf and get a short-lived link_token.
  //
  //     Required fields (from the spec):
  //       type                  → always "plaid" for Plaid workflows
  //       kind                  → "link_token_create" = new bank connection
  //       language              → UI language for the Plaid widget
  //       link_customization_name → "default" for English (required by Cybrid)
  //       customer_guid         → who is linking their bank account
  const workflow = await cybridRequest<WorkflowResponse>("/api/workflows", {
    method: "POST",
    body: {
      type: "plaid",
      kind: "link_token_create",
      language: "en",
      link_customization_name: "default",
      customer_guid,
    },
  });

  const workflow_guid = workflow.guid;
  console.log(`[plaid/workflow] Created workflow ${workflow_guid}, state: ${workflow.state}`);

  // 3️⃣  Save the workflow GUID so other routes can reference it later
  store.set("workflow_guid", workflow_guid);

  // 4️⃣  Poll the GET endpoint until Cybrid returns state = "completed".
  //     While state is "storing", Cybrid is talking to Plaid to generate the token.
  //     Once "completed", the response includes plaid_link_token — the key we need.
  const completed = await poll<WorkflowResponse>(
    () => cybridRequest<WorkflowResponse>(`/api/workflows/${workflow_guid}`),
    (w) => w.state === "completed" || w.state === "failed",
    { intervalMs: 1500, timeoutMs: 30000, label: "workflow" }
  );

  // 5️⃣  Handle failure
  if (completed.state === "failed") {
    return NextResponse.json(
      { error: "Workflow failed", failure_code: completed.failure_code },
      { status: 500 }
    );
  }

  // 6️⃣  The plaid_link_token is a short-lived (~30 min) token that the Plaid
  //     JavaScript SDK uses to open the bank-selection/login modal in the browser.
  //     We send it back to the frontend — it NEVER needs to be stored server-side.
  const plaid_link_token = completed.plaid_link_token!;
  console.log(`[plaid/workflow] Got link token: ${plaid_link_token.slice(0, 30)}...`);

  return NextResponse.json({
    workflow_guid,
    plaid_link_token,
    message: "Link token ready — pass this to the Plaid Link UI.",
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

// Both GET and POST call the same logic so you can test from the browser
export async function GET() {
  return handleWorkflow();
}

export async function POST() {
  return handleWorkflow();
}
