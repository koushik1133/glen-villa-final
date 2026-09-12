"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseUrl = supabaseUrl;
exports.isSupabaseConfigured = isSupabaseConfigured;
exports.hasServiceRole = hasServiceRole;
exports.browserClient = browserClient;
exports.serverClient = serverClient;
exports.adminClient = adminClient;
exports.checkSupabase = checkSupabase;
const ssr_1 = require("@supabase/ssr");
const supabase_js_1 = require("@supabase/supabase-js");
/**
 * SUPABASE CLIENTS
 *
 * Three clients, three trust levels. Keeping them in one file makes the
 * distinction impossible to miss, because mixing them up is how a service-role
 * key ends up in a browser bundle.
 *
 *  - browser  — anon key, user's session, RLS applies. Safe to ship to the client.
 *  - server   — anon key + the request's cookies, RLS applies *as that user*.
 *               This is the default for anything acting on a user's behalf.
 *  - admin    — service-role key, bypasses RLS. Server-only, never imported by a
 *               client component, and every call site must do its own
 *               authorisation check because the database will not.
 */
function supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
}
function anonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
/** True once the project is configured. The app degrades cleanly without it. */
function isSupabaseConfigured() {
    return Boolean(supabaseUrl() && anonKey());
}
function hasServiceRole() {
    return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
/** Browser client. Anon key only — RLS is the security boundary. */
function browserClient() {
    const url = supabaseUrl();
    const key = anonKey();
    if (!url || !key)
        throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)");
    return (0, ssr_1.createBrowserClient)(url, key);
}
/**
 * Server client bound to the request's cookies, so queries run as the signed-in
 * user and RLS decides what they can see. Prefer this over `adminClient`
 * everywhere — if a query needs the service role to work, that is usually a
 * missing policy rather than a reason to escalate.
 */
function serverClient(cookies) {
    const url = supabaseUrl();
    const key = anonKey();
    if (!url || !key)
        throw new Error("Supabase is not configured");
    return (0, ssr_1.createServerClient)(url, key, {
        cookies: {
            getAll: () => cookies.getAll(),
            setAll: (list) => {
                // Server Components cannot set cookies; middleware/route handlers can.
                // Swallowing here keeps read-only rendering working either way.
                try {
                    for (const { name, value, options } of list)
                        cookies.set?.(name, value, options);
                }
                catch {
                    /* read-only context */
                }
            },
        },
    });
}
/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for operations a user legitimately cannot perform as themselves —
 * provisioning staff accounts, background jobs, cross-tenant admin reporting.
 * Throws if imported where the key is absent, rather than silently falling back
 * to a weaker client and appearing to work.
 */
function adminClient() {
    if (typeof window !== "undefined") {
        throw new Error("adminClient() must never be called in the browser");
    }
    const url = supabaseUrl();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (Dashboard → Project Settings → API → service_role).");
    }
    return (0, supabase_js_1.createClient)(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
/** Health probe used by the setup screen and the deployment checklist. */
async function checkSupabase() {
    if (!isSupabaseConfigured()) {
        return { configured: false, reachable: false, schemaApplied: false, serviceRole: false, detail: "NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set" };
    }
    try {
        const res = await fetch(`${supabaseUrl()}/rest/v1/organizations?select=id&limit=1`, {
            headers: { apikey: anonKey(), authorization: `Bearer ${anonKey()}` },
            cache: "no-store",
        });
        const body = await res.text();
        // PGRST205 means the key was accepted but the table does not exist yet.
        const missing = body.includes("PGRST205") || body.includes("schema cache");
        return {
            configured: true,
            reachable: res.status !== 401,
            schemaApplied: res.ok && !missing,
            serviceRole: hasServiceRole(),
            detail: res.ok ? "schema applied" : missing ? "connected, schema not applied yet" : `HTTP ${res.status}`,
        };
    }
    catch (e) {
        return { configured: true, reachable: false, schemaApplied: false, serviceRole: hasServiceRole(), detail: e.message };
    }
}
