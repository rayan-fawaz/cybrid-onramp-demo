/**
 * db.ts — SQLite GUID Storage
 * 
 * PURPOSE: Store and retrieve GUIDs from Cybrid API calls.
 * 
 * HOW IT WORKS:
 * - Creates a single table called "kv" (key-value) in a file called "cybrid-store.db"
 * - You save a GUID:    db.set("customer_guid", "abc123...")
 * - You retrieve it:    db.get("customer_guid")  →  "abc123..."
 * 
 * WHY KEY-VALUE?
 * - We don't need complex tables with relationships
 * - We just need to remember: "what was the customer_guid?" → "abc123"
 * - Think of it like a dictionary / lookup table
 * 
 * THE TABLE LOOKS LIKE:
 *   ┌──────────────────────────┬──────────────────────────────────┬─────────────────────┐
 *   │ key                      │ value                            │ updated_at          │
 *   ├──────────────────────────┼──────────────────────────────────┼─────────────────────┤
 *   │ customer_guid            │ abc123def456...                  │ 2026-02-27 10:00:00 │
 *   │ fiat_account_guid        │ xyz789ghi012...                  │ 2026-02-27 10:05:00 │
 *   │ trading_account_guid     │ mno345pqr678...                  │ 2026-02-27 10:05:00 │
 *   └──────────────────────────┴──────────────────────────────────┴─────────────────────┘
 */

import Database from "better-sqlite3";
import path from "path";

// ---------------------------------------------------------------------------
// 1. OPEN (or create) the database file
// ---------------------------------------------------------------------------
// path.join(__dirname, ...) builds the file path relative to this file's location.
// In development, the DB file ends up at the project root: cybrid-demo/cybrid-store.db
const DB_PATH = path.join(process.cwd(), "cybrid-store.db");

// This line opens the database. If the file doesn't exist yet, SQLite creates it.
const db = new Database(DB_PATH);

// WAL mode = "Write-Ahead Logging" — makes reads faster and prevents locking issues.
// Don't worry about the details — it's a best practice for SQLite.
db.pragma("journal_mode = WAL");

// ---------------------------------------------------------------------------
// 2. CREATE the table (if it doesn't already exist)
// ---------------------------------------------------------------------------
// This SQL says: "Create a table called 'kv' with 3 columns, but only if it
// doesn't already exist (so it's safe to run multiple times)"
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ---------------------------------------------------------------------------
// 3. PREPARE reusable SQL statements
// ---------------------------------------------------------------------------
// "Prepared statements" are pre-compiled SQL queries. They're faster because
// SQLite only needs to parse them once, then can run them many times.

// UPSERT = "INSERT or UPDATE"
// If the key already exists, it updates the value. If not, it inserts a new row.
const upsertStmt = db.prepare(`
  INSERT INTO kv (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = datetime('now')
`);

// Simple SELECT to get a value by its key
const getStmt = db.prepare(`SELECT value FROM kv WHERE key = ?`);

// Get ALL key-value pairs (useful for debugging — "show me everything stored")
const getAllStmt = db.prepare(`SELECT key, value, updated_at FROM kv ORDER BY updated_at DESC`);

// Delete a specific key
const deleteStmt = db.prepare(`DELETE FROM kv WHERE key = ?`);

// ---------------------------------------------------------------------------
// 4. EXPORT friendly functions (this is what the rest of your app uses)
// ---------------------------------------------------------------------------
export const store = {
  /**
   * Save a GUID (or any value) with a name.
   * Example: store.set("customer_guid", "abc123def456")
   */
  set(key: string, value: string): void {
    upsertStmt.run(key, value);
  },

  /**
   * Retrieve a saved value by its name.
   * Example: store.get("customer_guid")  →  "abc123def456"
   * Returns null if the key doesn't exist.
   */
  get(key: string): string | null {
    const row = getStmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },

  /**
   * Get all stored key-value pairs.
   * Useful for debugging: "what do I have saved so far?"
   * Returns: [{ key: "customer_guid", value: "abc...", updated_at: "..." }, ...]
   */
  getAll(): { key: string; value: string; updated_at: string }[] {
    return getAllStmt.all() as { key: string; value: string; updated_at: string }[];
  },

  /**
   * Delete a stored value.
   * Example: store.delete("customer_guid")
   */
  delete(key: string): void {
    deleteStmt.run(key);
  },
};
