import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service_role key.
 *
 * This bypasses RLS, so it must never be imported into a client component.
 * Every table holding customer data has RLS on with no permissive policy, so
 * this is the only path that can read leads and conversations.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** True when Supabase credentials are present and the schema is reachable. */
export async function dbReady(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await db().from("villa_projects").select("id").limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
