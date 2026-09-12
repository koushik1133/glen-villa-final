"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuthEvent = logAuthEvent;
exports.stampLastLogin = stampLastLogin;
const client_1 = require("../supabase/client");
function logAuthEvent(e) {
    // Both values are attacker-supplied, and a log line an attacker can put a
    // newline into is a log line an attacker can forge entries in. JSON.stringify
    // escapes the separators, so a crafted address stays one field on one line.
    const line = `[auth] outcome=${e.outcome} method=${e.method} email=${JSON.stringify(e.email)} source=${JSON.stringify(e.source)} at=${new Date().toISOString()}`;
    if (e.outcome === "success")
        console.info(line);
    else
        console.warn(line);
}
/**
 * Stamp `profiles.last_login_at` for the account that just authenticated.
 *
 * The admin team screen renders this column as "last seen" and nothing had ever
 * written it, so every account read "never" — worse than showing nothing,
 * because it looks like an answer and it hides a dormant account that is
 * suddenly being used.
 *
 * It takes the service role because the RLS policy on `profiles` grants writes
 * only to a holder of `users.manage`; a member cannot stamp their own row. The
 * escalation is confined to one column, on the row of the user who has just
 * proved they hold the credential. A failure is swallowed on purpose:
 * bookkeeping must never turn a valid sign-in into a rejected one, and the log
 * line above is the durable record either way.
 */
async function stampLastLogin(userId) {
    if (!userId || !(0, client_1.hasServiceRole)())
        return;
    try {
        await (0, client_1.adminClient)()
            .from("profiles")
            .update({ last_login_at: new Date().toISOString() })
            .eq("id", userId);
    }
    catch {
        /* the session is already valid; do not fail the sign-in over a timestamp */
    }
}
