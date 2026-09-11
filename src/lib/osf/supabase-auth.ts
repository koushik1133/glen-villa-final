import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optional } from "@/lib/osf/env";

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

function url(): string {
  const value = optional("OSF_SUPABASE_URL");
  if (!value) throw new Error("OSF_SUPABASE_URL is not set");
  return value;
}

function anonKey(): string {
  const value = optional("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY");
  if (!value) throw new Error("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY is not set");
  return value;
}

/** True when Supabase Auth can be used at all. */
export function supabaseAuthConfigured(): boolean {
  return Boolean(optional("OSF_SUPABASE_URL") && optional("NEXT_PUBLIC_OSF_SUPABASE_ANON_KEY"));
}

/** Browser client — used only by the sign-in form. */
export function browserClient(): SupabaseClient {
  return createBrowserClient(url(), anonKey());
}

type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: Record<string, unknown>): void;
};

/**
 * Server client for Server Components, Route Handlers and Server Actions.
 *
 * Server Components cannot write cookies. Supabase refreshes the access token
 * during `getUser()`, so the write is attempted and would throw there — it is
 * swallowed, because the middleware performs the same refresh on every request
 * and *can* write. Losing the write here therefore costs nothing.
 */
export async function serverClient(): Promise<SupabaseClient> {
  const { cookies } = await import("next/headers");
  const store = (await cookies()) as unknown as CookieStore;

  return createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
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
export function middlewareClient(request: Request, setCookie: (name: string, value: string, options?: Record<string, unknown>) => void) {
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

  return createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => parsed,
      setAll: (list) => {
        for (const { name, value, options } of list) setCookie(name, value, options);
      },
    },
  });
}
