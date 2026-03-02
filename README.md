# Cybrid On-Ramp Demo

Sandbox prototype of a fiat → USDC on-ramp using the [Cybrid](https://www.cybrid.xyz/) API.

Built with Next.js, TypeScript, SQLite, and Plaid Link.

---

## What It Does

A dashboard that walks through the full Cybrid on-ramp flow:

1. **Authenticate** — OAuth2 client credentials → Bearer token
2. **Create Customer** — Register an individual customer profile
3. **KYC Verification** — Identity check (sandbox auto-passes)
4. **Create Accounts** — USD fiat account + USDC trading account
5. **Link Bank (Plaid)** — Connect an external bank via Plaid Link
6. **Fund via ACH** — Pull USD from bank into fiat account *(skippable in sandbox)*
7. **Convert USD → USDC** — Get a quote, execute the trade

All GUIDs are saved to a local SQLite database so the flow survives page refreshes.

---

## Setup

```bash
npm install
cp .env.example .env.local   # add your Cybrid sandbox credentials
npm run dev                   # open http://localhost:3000
```

Your `.env.local` needs:

```
CYBRID_BANK_CLIENT_ID=<from cybrid dashboard>
CYBRID_BANK_CLIENT_SECRET=<from cybrid dashboard>
CYBRID_BANK_GUID=<from cybrid dashboard>
CYBRID_BANK_BASE_URL=https://bank.sandbox.cybrid.app
CYBRID_ID_BASE_URL=https://id.sandbox.cybrid.app
```

---

## Sandbox Notes

- **KYC auto-passes** — sandbox uses `passed_immediately` behaviour
- **ACH is blocked** — sandbox Plaid only has Canadian test banks which stay `unverified`, so ACH transfers can't complete. Skip step 6.
- **Trades work anyway** — sandbox ignores fiat balance and auto-approves trades, so the USD → USDC conversion goes through with $0
- **Trade settles but never completes** — `settling` is the terminal state in sandbox (production would continue to `completed` after on-chain settlement)
- **Plaid credentials**: username `user_good`, password `pass_good`

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Dashboard UI
│   ├── plaid/page.tsx           # Plaid Link page
│   └── api/
│       ├── auth/                # OAuth2 token
│       ├── customer/create/     # Create customer
│       ├── customer/verify/     # KYC start + status
│       ├── accounts/create/     # Fiat + trading accounts
│       ├── accounts/status/     # Balance check
│       ├── plaid/workflow/      # Plaid link token
│       ├── plaid/external-bank/ # Exchange Plaid token
│       ├── transfers/create/    # ACH deposit
│       ├── trades/quote/        # Get trade quote (30s expiry)
│       ├── trades/execute/      # Execute quote
│       └── trades/status/       # Final balances
├── components/                  # UI components
├── hooks/useWorkflow.ts         # Step orchestration
└── lib/
    ├── cybrid-client.ts         # Authenticated API wrapper + token cache
    ├── db.ts                    # SQLite key-value store
    └── poll.ts                  # Async polling helper
```

---

## How It Works

Each API route wraps a Cybrid endpoint. The server-side code handles OAuth2 token management, async polling (Cybrid operations go through state transitions like `storing → completed`), and GUID persistence.

The frontend is a single-page dashboard with a step-by-step sidebar. Each step is gated — you need to finish the previous one before moving forward. Click **Run All** to auto-run steps 1–4, then use Plaid Link for step 5, skip step 6, and execute the trade in step 7.
# cybrid-onramp-demo
