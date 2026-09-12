"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiError = apiError;
exports.apiOk = apiOk;
exports.apiFail = apiFail;
const server_1 = require("next/server");
const session_1 = require("./session");
/**
 * Uniform API error handling.
 *
 * Clients get a short message and a correlation id. Stack traces, SQL and
 * library versions stay on the server — leaking them hands an attacker the
 * schema and the dependency list for free.
 */
function apiError(e) {
    if (e instanceof session_1.AuthError) {
        return server_1.NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    const id = crypto.randomUUID();
    console.error(`[api:${id}]`, e instanceof Error ? e.stack : e);
    return server_1.NextResponse.json({ ok: false, error: "Something went wrong. Quote this reference if you report it.", ref: id }, { status: 500 });
}
function apiOk(data, status = 200) {
    return server_1.NextResponse.json({ ok: true, ...data }, { status });
}
/**
 * A request the caller can fix — wrong file type, too large, malformed body.
 *
 * Separate from `apiError`, which is for faults the caller cannot do anything
 * about and which get a correlation id and a log line. The distinction that
 * matters to clients is `ok`: passing a rejection through `apiOk` sets
 * `ok: true` next to an error message and a 4xx status, and every caller in this
 * codebase branches on `!json.ok` — so the rejection reads as a success.
 */
function apiFail(error, status = 400) {
    return server_1.NextResponse.json({ ok: false, error }, { status });
}
