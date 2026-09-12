"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = db;
exports.dbReady = dbReady;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("./env");
let client = null;
/**
 * Server-side Supabase client using the service_role key.
 *
 * This bypasses RLS, so it must never be imported into a client component.
 * Every table holding customer data has RLS on with no permissive policy, so
 * this is the only path that can read leads and conversations.
 */
function db() {
    if (!client) {
        client = (0, supabase_js_1.createClient)(env_1.env.supabaseUrl, env_1.env.supabaseServiceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
    return client;
}
/** True when Supabase credentials are present and the schema is reachable. */
async function dbReady() {
    try {
        const { error } = await db().from("villa_projects").select("id").limit(1);
        if (error)
            return { ok: false, error: error.message };
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
