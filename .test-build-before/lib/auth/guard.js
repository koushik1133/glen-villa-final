"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guard = guard;
const server_1 = require("next/server");
const session_1 = require("./session");
/**
 * Route guard that returns a response instead of throwing.
 *
 * Handlers written without try/catch would otherwise turn an authorisation
 * failure into a 500, which both hides the real reason from the user and looks
 * like a bug to whoever is on call. Usage:
 *
 *   const denied = await guard("customers.read");
 *   if (denied) return denied;
 */
async function guard(...permissions) {
    try {
        await (0, session_1.requirePermission)(...permissions);
        return null;
    }
    catch (e) {
        if (e instanceof session_1.AuthError) {
            return server_1.NextResponse.json({ ok: false, error: e.message }, { status: e.status });
        }
        return server_1.NextResponse.json({ ok: false, error: "Authorization failed." }, { status: 403 });
    }
}
