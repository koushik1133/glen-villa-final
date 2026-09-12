"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAuthConfigured = supabaseAuthConfigured;
exports.browserClient = browserClient;
exports.serverClient = serverClient;
exports.middlewareClient = middlewareClient;
const ssr_1 = require("@supabase/ssr");
const env_1 = require("@/lib/osf/env");
/**
 * Request-scoped Supabase clients.
 *
 * This is deliberately NOT src/lib/supabase.ts. That module returns a
 * service_role client which bypasses RLS — correct for the WhatsApp webhook and
 * the cron workers, which act on behalf of the system and have no user.
 *
 * Everything driven by a signed-in person goes through the clients here
 * instead. They carry the user's JWT, so Postgres evaluates the RLS policies in
 * 004_auth_rbac.sql and a bug in an API route cannot leak another department's
 * rows. Two layers, not one: the route checks permissions in TypeScript AND the
 * database enforces them again.
 */
function url() {
    const value = (0, env_1.optional)("OSF_SUPABASE_URL");
    if (!value)
        throw new Error("OSF_SUPABASE_URL is not set");
    return value;
}
function anonKey() {
    const value = (0, env_1.optional)("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY");
    if (!value)
        throw new Error("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY is not set");
    return value;
}
/** True when Supabase Auth can be used at all. */
function supabaseAuthConfigured() {
    return Boolean((0, env_1.optional)("OSF_SUPABASE_URL") && (0, env_1.optional)("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY"));
}
/** Browser client — used only by the sign-in form. */
function browserClient() {
    return (0, ssr_1.createBrowserClient)(url(), anonKey());
}
/**
 * Server client for Server Components, Route Handlers and Server Actions.
 *
 * Server Components cannot write cookies. Supabase refreshes the access token
 * during `getUser()`, so the write is attempted and would throw there — it is
 * swallowed, because the middleware performs the same refresh on every request
 * and *can* write. Losing the write here therefore costs nothing.
 */
async function serverClient() {
    const { cookies } = await Promise.resolve().then(() => __importStar(require("next/headers")));
    const store = (await cookies());
    return (0, ssr_1.createServerClient)(url(), anonKey(), {
        cookies: {
            getAll: () => store.getAll(),
            setAll: (list) => {
                try {
                    for (const { name, value, options } of list)
                        store.set(name, value, options);
                }
                catch {
                    // Server Component render pass — the middleware owns the refresh.
                }
            },
        },
    });
}
/**
 * Client bound to an explicit request/response pair, for middleware.
 * The response must be returned by the caller or the refreshed cookies are lost.
 */
function middlewareClient(request, setCookie) {
    const header = request.headers.get("cookie") ?? "";
    const parsed = header
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const eq = part.indexOf("=");
        return eq === -1
            ? { name: part, value: "" }
            : { name: part.slice(0, eq), value: decodeURIComponent(part.slice(eq + 1)) };
    });
    return (0, ssr_1.createServerClient)(url(), anonKey(), {
        cookies: {
            getAll: () => parsed,
            setAll: (list) => {
                for (const { name, value, options } of list)
                    setCookie(name, value, options);
            },
        },
    });
}
