/**
 * cybrid-client.ts — HTTP Wrapper for Cybrid API
 *
 * WHAT THIS FILE DOES:
 * 1. Gets a Bearer Token from Cybrid's auth server (and caches it so we don't
 *    request a new one every single call — tokens last 30 minutes)
 * 2. Provides a simple `cybridRequest()` function that:
 *    - Automatically attaches the Bearer Token to every request
 *    - Logs every request and response (method, URL, status, body)
 *    - Throws a clear error if something goes wrong
 *
 * HOW YOU USE IT (in other files):
 *    import { cybridRequest } from "@/lib/cybrid-client";
 *
 *    const customer = await cybridRequest("/api/customers", {
 *      method: "POST",
 *      body: { type: "individual" },
 *    });
 *    // customer = { guid: "abc123", state: "storing", ... }
 *
 * YOU NEVER NEED TO:
 *    - Manually get a token
 *    - Manually set the Authorization header
 *    - Manually JSON.stringify the body
 *    - Manually JSON.parse the response
 *    This wrapper does ALL of that for you.
 */

// ==========================================================================
// 1. READ ENVIRONMENT VARIABLES
// ==========================================================================

// These come from your .env.local file. If any are missing, we crash
// immediately with a clear message (better than a cryptic error later).
const ID_BASE_URL = process.env.CYBRID_ID_BASE_URL;
const BANK_BASE_URL = process.env.CYBRID_BANK_BASE_URL;
const CLIENT_ID = process.env.CYBRID_BANK_CLIENT_ID;
const CLIENT_SECRET = process.env.CYBRID_BANK_CLIENT_SECRET;

function checkEnvVars() {
  const missing: string[] = [];
  if (!ID_BASE_URL) missing.push("CYBRID_ID_BASE_URL");
  if (!BANK_BASE_URL) missing.push("CYBRID_BANK_BASE_URL");
  if (!CLIENT_ID) missing.push("CYBRID_BANK_CLIENT_ID");
  if (!CLIENT_SECRET) missing.push("CYBRID_BANK_CLIENT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing environment variables: ${missing.join(", ")}\n` +
        `   → Make sure these are set in your .env.local file.`
    );
  }
}

// ==========================================================================
// 2. TOKEN CACHING
// ==========================================================================
// We store the token in memory so we don't request a new one for every call.
// Tokens last ~30 minutes (1800 seconds). We refresh 60 seconds early to
// avoid using an expired token mid-request.

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0; // Unix timestamp (milliseconds) when token expires

// ==========================================================================
// 3. GET A BEARER TOKEN
// ==========================================================================

/**
 * Requests a new Bearer Token from Cybrid's Identity Server.
 *
 * HOW OAUTH2 CLIENT CREDENTIALS WORKS:
 * - You send your Client ID + Secret to the auth server
 * - It gives you back a temporary "access_token"
 * - You attach that token to every subsequent API call
 * - It's like showing your ID badge to get into a building
 *
 * SCOPES = permissions. Each scope grants access to specific operations.
 * "customers:execute" = permission to CREATE customers
 * "customers:read" = permission to READ/LIST customers
 * We request all scopes we'll need across the entire demo.
 */
async function getToken(): Promise<string> {
  checkEnvVars();

  // If we already have a valid (non-expired) token, reuse it
  if (cachedToken && Date.now() < tokenExpiresAt) {
    console.log("🔑 [Auth] Reusing cached token (expires in", 
      Math.round((tokenExpiresAt - Date.now()) / 1000), "seconds)");
    return cachedToken;
  }

  console.log("🔑 [Auth] Requesting new Bearer Token...");

  // All the permissions we need for the full demo flow
  const scopes = [
    // Customer operations
    "customers:read", "customers:write", "customers:execute",
    // Identity verification (KYC)
    "identity_verifications:read", "identity_verifications:write",
    "identity_verifications:execute",
    // Accounts (fiat + trading)
    "accounts:read", "accounts:execute",
    // Quotes (for funding + trading)
    "quotes:read", "quotes:execute",
    // Trades (buy/sell crypto)
    "trades:read", "trades:execute",
    // Transfers (move money)
    "transfers:read", "transfers:write", "transfers:execute",
    // External bank accounts (Plaid-linked)
    "external_bank_accounts:read", "external_bank_accounts:write",
    "external_bank_accounts:execute",
    // Workflows (Plaid link token generation)
    "workflows:read", "workflows:execute",
    // Bank info
    "banks:read",
    // Prices
    "prices:read",
  ].join(" "); // Scopes are space-separated

  const response = await fetch(`${ID_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: scopes,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ [Auth] Token request FAILED:", response.status, data);
    throw new Error(
      `Auth failed (${response.status}): ${data.error_description || data.error || JSON.stringify(data)}`
    );
  }

  // Cache the token. expires_in is in seconds, we convert to milliseconds.
  // Subtract 60 seconds as a safety buffer (refresh before it actually expires).
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  console.log(
    `✅ [Auth] Got token (expires in ${data.expires_in}s). ` +
    `First 20 chars: ${cachedToken!.substring(0, 20)}...`
  );

  return cachedToken!;
}

// ==========================================================================
// 4. THE MAIN REQUEST FUNCTION (this is what you use everywhere)
// ==========================================================================

/**
 * Options you can pass to cybridRequest().
 *
 * method:  "GET", "POST", "PATCH", "DELETE" (defaults to "GET")
 * body:    A JavaScript object — we JSON.stringify it for you
 * params:  URL query parameters — e.g., { page: 1, per_page: 10 }
 */
interface CybridRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  params?: Record<string, string | number>;
}

/**
 * Make an authenticated request to the Cybrid Bank API.
 *
 * @param path   - The API path, e.g., "/api/customers"
 * @param opts   - Method, body, query params
 * @returns      - The parsed JSON response
 *
 * EXAMPLE:
 *   const result = await cybridRequest("/api/customers", {
 *     method: "POST",
 *     body: { type: "individual" },
 *   });
 */
export async function cybridRequest<T = Record<string, unknown>>(
  path: string,
  opts: CybridRequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = opts;

  // --- Get a valid token (cached or fresh) ---
  const token = await getToken();

  // --- Build the full URL ---
  let url = `${BANK_BASE_URL}${path}`;

  // If there are query params, append them: /api/customers?page=1&per_page=10
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, String(value));
    }
    url += `?${searchParams.toString()}`;
  }

  // --- Log the request ---
  console.log(`\n📤 [Request] ${method} ${url}`);
  if (body) {
    console.log(`   Body:`, JSON.stringify(body, null, 2));
  }

  // --- Make the HTTP call ---
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Only include body for methods that support it
    ...(body && { body: JSON.stringify(body) }),
  });

  // --- Parse the response ---
  // Some responses (like 204 No Content) have no body
  let data: T;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = {} as T;
  }

  // --- Log the response ---
  if (response.ok) {
    console.log(`📥 [Response] ${response.status} ${response.statusText}`);
    console.log(`   Data:`, JSON.stringify(data, null, 2));
  } else {
    // Log errors prominently
    console.error(`❌ [Response] ${response.status} ${response.statusText}`);
    console.error(`   Error:`, JSON.stringify(data, null, 2));
    throw new Error(
      `Cybrid API error (${response.status} on ${method} ${path}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

// ==========================================================================
// 5. EXPORT getToken for testing auth independently
// ==========================================================================
export { getToken };
