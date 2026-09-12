"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keepAlive = keepAlive;
const server_1 = require("next/server");
/**
 * Keep a fire-and-forget promise alive past the response.
 *
 * On Vercel, work that is neither awaited nor registered with the platform is
 * frozen once the response is sent, so a bare `void promise` may never finish.
 * `after()` (Next 15) registers it; outside a request scope (tests, scripts)
 * it throws, and we simply let the promise run on the long-lived process.
 */
function keepAlive(promise) {
    const settled = promise.catch(() => { });
    try {
        (0, server_1.after)(() => settled);
    }
    catch {
        void settled;
    }
}
