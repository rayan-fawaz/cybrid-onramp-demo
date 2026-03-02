/**
 * poll.ts — Generic "keep trying until it's done" helper
 *
 * WHY THIS EXISTS:
 * Cybrid is asynchronous. When you create a customer, it starts as "storing".
 * When you start KYC, it starts as "waiting". You can't use the result until
 * it reaches the final state (like "completed" or "verified").
 *
 * Instead of writing a loop every time, this helper does it for you.
 *
 * HOW YOU USE IT:
 *
 *   const result = await poll(
 *     () => cybridRequest(`/api/identity_verifications/${guid}`),  // what to fetch
 *     (data) => data.state === "completed",                        // when to stop
 *     { intervalMs: 1500, timeoutMs: 30000 }                      // how long to wait
 *   );
 *
 * It will call the fetch function every 1.5 seconds until:
 *   - The condition returns true (success ✅)
 *   - OR 30 seconds pass (timeout ❌)
 *
 * ANALOGY: Like F5-refreshing your email inbox every few seconds waiting for
 * an important email — but automated.
 */

interface PollOptions {
  /** How many milliseconds to wait between each check. Default: 2000 (2 seconds) */
  intervalMs?: number;
  /** How many milliseconds total before giving up. Default: 60000 (60 seconds) */
  timeoutMs?: number;
  /** Optional label for log messages, e.g. "identity_verification" */
  label?: string;
}

/**
 * Polls a function until a condition is met or timeout is reached.
 *
 * @param fetchFn    - An async function that fetches the current state
 * @param isDone     - A function that returns true when we should stop polling
 * @param options    - Interval, timeout, and label settings
 * @returns          - The final result when isDone returns true
 * @throws           - Error if timeout is reached before isDone is true
 */
export async function poll<T>(
  fetchFn: () => Promise<T>,
  isDone: (result: T) => boolean,
  options: PollOptions = {}
): Promise<T> {
  const { intervalMs = 2000, timeoutMs = 60000, label = "resource" } = options;

  const startTime = Date.now();
  let attempt = 0;

  while (true) {
    attempt++;
    const elapsed = Date.now() - startTime;

    // Check if we've been waiting too long
    if (elapsed > timeoutMs) {
      throw new Error(
        `⏱️ Poll timeout: ${label} did not reach expected state within ${timeoutMs / 1000}s ` +
        `(checked ${attempt} times)`
      );
    }

    // Fetch the current state
    const result = await fetchFn();

    console.log(
      `🔄 [Poll #${attempt}] ${label} — elapsed: ${Math.round(elapsed / 1000)}s`
    );

    // Check if we're done
    if (isDone(result)) {
      console.log(`✅ [Poll] ${label} reached target state after ${attempt} attempt(s)`);
      return result;
    }

    // Not done yet — wait before trying again
    await sleep(intervalMs);
  }
}

/** Simple sleep helper: await sleep(2000) waits 2 seconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
