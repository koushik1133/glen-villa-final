"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleError = handleError;
exports.ok = ok;
exports.fail = fail;
const node_crypto_1 = __importDefault(require("node:crypto"));
const server_1 = require("next/server");
const auth_1 = require("./auth");
/** Uniform error shape. Never leaks internals to the client. */
function handleError(e) {
    if (e instanceof auth_1.AuthError) {
        return server_1.NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    // The internal message stays on the server. Returning e.message handed the
    // client PostgREST errors, file paths and library internals, and reported
    // every server fault as a 400 so genuine outages looked like bad input.
    const ref = node_crypto_1.default.randomUUID();
    console.error(`[ops:${ref}]`, e instanceof Error ? e.stack : e);
    return server_1.NextResponse.json({ ok: false, error: "Something went wrong. Quote this reference if you report it.", ref }, { status: 500 });
}
function ok(data, status = 200) {
    return server_1.NextResponse.json({ ok: true, ...data }, { status });
}
/**
 * A refusal. Use this for every non-2xx reply.
 *
 * `ok({ error: "Missing permission" }, 403)` reads like a refusal but emits
 * `{ ok: true, error: ... }`, and every client in this app decides success by
 * reading `json.ok`. So a permission denial, a "not your case" and an expired
 * download token all arrived in the browser flagged as successes: the checklist
 * editor and the case controls showed no error, kept their optimistic state and
 * told the officer the write had gone through. The status code carried the
 * truth and nothing read it. `fail()` makes the body and the status agree.
 */
function fail(error, status) {
    return server_1.NextResponse.json({ ok: false, error }, { status });
}
