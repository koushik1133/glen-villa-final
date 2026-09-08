import { after } from "next/server";

/**
 * Keep a fire-and-forget promise alive past the response.
 *
 * On Vercel, work that is neither awaited nor registered with the platform is
 * frozen once the response is sent, so a bare `void promise` may never finish.
 * `after()` (Next 15) registers it; outside a request scope (tests, scripts)
 * it throws, and we simply let the promise run on the long-lived process.
 */
export function keepAlive(promise: Promise<unknown>): void {
  const settled = promise.catch(() => {});
  try {
    after(() => settled);
  } catch {
    void settled;
  }
}
