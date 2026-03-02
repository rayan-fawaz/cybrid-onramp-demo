/**
 * GET /api/auth
 *
 * PURPOSE: Test that your Cybrid credentials work.
 *
 * WHAT HAPPENS WHEN YOU HIT THIS ENDPOINT:
 * 1. It calls getToken() which sends your Client ID + Secret to Cybrid
 * 2. If Cybrid accepts them → you get back "authenticated: true"
 * 3. If they're wrong → you get an error message
 *
 * HOW TO TEST:
 * - Start the dev server: npm run dev
 * - Open browser: http://localhost:3000/api/auth
 * - You should see: { "authenticated": true, "expires_in_seconds": 1740 }
 *
 * WHY THIS IS AN "API ROUTE":
 * - In Next.js, any file at src/app/api/.../route.ts becomes an HTTP endpoint
 * - This file is at src/app/api/auth/route.ts → URL = /api/auth
 * - The function name "GET" means it handles GET requests
 */

import { getToken } from "@/lib/cybrid-client";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Attempt to get a token — this proves our credentials work
    const token = await getToken();

    return NextResponse.json({
      authenticated: true,
      message: "✅ Successfully connected to Cybrid sandbox!",
      // Show first 20 chars of token (for debugging, never show the full token)
      token_preview: token.substring(0, 20) + "...",
    });
  } catch (error) {
    // If auth fails, return the error message
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        authenticated: false,
        message: "❌ Authentication failed",
        error: message,
      },
      { status: 401 }
    );
  }
}
