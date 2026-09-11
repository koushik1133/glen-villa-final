import { optional } from "../env";
import { db } from "../supabase";

/**
 * WhatsApp go-live readiness.
 *
 * Every check reads real state — an env var that is actually set, a live call
 * to Meta, a table that actually exists. Nothing here reports "connected" from
 * a stored flag that could be stale.
 */

export type CheckState = "ok" | "missing" | "error" | "checking";

export interface Check {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  /** Blocks go-live entirely, vs. degrades a capability. */
  blocking: boolean;
  fix?: string;
}

function isSet(name: string): boolean {
  return Boolean(optional(name));
}

/** Verifies the token and phone number id against Meta, rather than assuming. */
async function verifyPhoneNumber(): Promise<Check> {
  const id = optional("WHATSAPP_PHONE_NUMBER_ID");
  const token = optional("WHATSAPP_ACCESS_TOKEN");
  const version = optional("WHATSAPP_API_VERSION", "v21.0");

  if (!id || !token) {
    return {
      id: "phone",
      label: "WhatsApp number reachable",
      state: "missing",
      detail: "Needs WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.",
      blocking: true,
      fix: "developers.facebook.com → your App → WhatsApp → API Setup",
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${id}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      const body = await res.text();
      return {
        id: "phone",
        label: "WhatsApp number reachable",
        state: "error",
        detail: `Meta rejected the credentials (${res.status}). ${body.slice(0, 160)}`,
        blocking: true,
        fix: "A temporary token expires in 24h — generate a permanent System User token.",
      };
    }
    const j = (await res.json()) as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    };
    return {
      id: "phone",
      label: "WhatsApp number reachable",
      state: "ok",
      detail: `${j.verified_name ?? "Unnamed"} · ${j.display_phone_number ?? id}${
        j.quality_rating ? ` · quality ${j.quality_rating}` : ""
      }`,
      blocking: true,
    };
  } catch (e) {
    return {
      id: "phone",
      label: "WhatsApp number reachable",
      state: "error",
      detail: e instanceof Error ? e.message : "Could not reach Meta",
      blocking: true,
    };
  }
}

async function checkKnowledgeBase(): Promise<Check> {
  try {
    const { data, error } = await db()
      .from("villa_projects")
      .select("name, price_per_sft_inr")
      .limit(1);
    if (error) {
      return {
        id: "kb",
        label: "Knowledge base loaded",
        state: "error",
        detail: `Schema not applied: ${error.message}`,
        blocking: true,
        fix: "Run 001_schema.sql then 002_seed.sql in the Supabase SQL editor.",
      };
    }
    const project = data?.[0] as { name?: string; price_per_sft_inr?: number } | undefined;
    if (!project) {
      return {
        id: "kb",
        label: "Knowledge base loaded",
        state: "missing",
        detail: "Schema exists but no project is seeded — the agent has nothing to answer from.",
        blocking: true,
        fix: "Run 002_seed.sql.",
      };
    }
    return {
      id: "kb",
      label: "Knowledge base loaded",
      state: "ok",
      detail: `${project.name}${project.price_per_sft_inr ? ` · ₹${project.price_per_sft_inr}/sft` : ""}`,
      blocking: true,
    };
  } catch (e) {
    return {
      id: "kb",
      label: "Knowledge base loaded",
      state: "error",
      detail: e instanceof Error ? e.message : "Database unreachable",
      blocking: true,
    };
  }
}

/**
 * The concurrency functions from 003_platform.sql. Without them every inbound
 * message fails at lead creation, so this is as blocking as the schema itself.
 */
async function checkPlatformFunctions(): Promise<Check> {
  try {
    const { error } = await db().rpc("villa_acquire_lock", {
      p_key: "readiness:probe",
      p_holder: "00000000-0000-0000-0000-000000000000",
      p_ttl_seconds: 1,
    });
    if (error) {
      return {
        id: "platform",
        label: "Concurrency functions installed",
        state: "error",
        detail: `villa_acquire_lock is missing — inbound messages will fail (${error.message}).`,
        blocking: true,
        fix: "Run 003_platform.sql in the Supabase SQL editor (after 001 and 002).",
      };
    }
    return {
      id: "platform",
      label: "Concurrency functions installed",
      state: "ok",
      detail: "Per-conversation locking, atomic lead upserts and the broadcast queue are ready.",
      blocking: true,
    };
  } catch (e) {
    return {
      id: "platform",
      label: "Concurrency functions installed",
      state: "error",
      detail: e instanceof Error ? e.message : "Database unreachable",
      blocking: true,
    };
  }
}

/**
 * Live check against the Evolution server: reachable, and the WhatsApp
 * session actually connected (QR scanned). "open" is the connected state.
 */
async function verifyEvolution(): Promise<Check> {
  const url = optional("EVOLUTION_API_URL");
  const key = optional("EVOLUTION_API_KEY");
  const instance = optional("EVOLUTION_INSTANCE");

  if (!url || !key || !instance) {
    return {
      id: "evolution",
      label: "Evolution server connected",
      state: "missing",
      detail: "Needs EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE.",
      blocking: true,
      fix: "Host Evolution API (Railway/VPS), create an instance, put its URL + key here.",
    };
  }

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/instance/connectionState/${instance}`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        id: "evolution",
        label: "Evolution server connected",
        state: "error",
        detail: `The Evolution server answered ${res.status} — wrong EVOLUTION_API_KEY or instance name.`,
        blocking: true,
      };
    }
    const json = (await res.json()) as { instance?: { state?: string } };
    const state = json.instance?.state ?? "unknown";
    if (state !== "open") {
      return {
        id: "evolution",
        label: "Evolution server connected",
        state: "error",
        detail: `Server reachable but the WhatsApp session is "${state}" — the QR code has not been scanned (or the phone dropped the session).`,
        blocking: true,
        fix: "Open the Evolution manager, show the QR for this instance, scan it with the WhatsApp app.",
      };
    }
    return {
      id: "evolution",
      label: "Evolution server connected",
      state: "ok",
      detail: `Session "${instance}" is live — messages flow through your own Evolution server. No Meta account involved.`,
      blocking: true,
    };
  } catch {
    return {
      id: "evolution",
      label: "Evolution server connected",
      state: "error",
      detail: "Could not reach EVOLUTION_API_URL at all.",
      blocking: true,
      fix: "Is the server running? Is the URL https and public?",
    };
  }
}

export async function whatsappReadiness(): Promise<{
  checks: Check[];
  ready: boolean;
  blockingCount: number;
}> {
  const provider = optional("LLM_PROVIDER", "anthropic");
  const aiKey = provider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY";

  // Which transport is live decides which checks matter: Evolution mode makes
  // every Meta credential irrelevant, and vice versa.
  const { env } = await import("../env");
  const transport = env.whatsappProvider;

  const staticChecks: Check[] = [
    {
      id: "ai",
      label: "AI brain configured",
      state: isSet(aiKey) ? "ok" : "missing",
      detail: isSet(aiKey)
        ? provider === "groq"
          ? "Groq (free tier) — rate-limited, replies can take 40–180s. Fine for testing, not for live customers."
          : "Anthropic — production quality."
        : `${aiKey} is not set.`,
      blocking: true,
      fix: provider === "groq" ? "Set LLM_PROVIDER=anthropic before real customers." : undefined,
    },
    {
      id: "provider",
      label: "Active transport",
      state: "ok",
      detail:
        transport === "evolution"
          ? "Evolution (unofficial, free, no Meta). Flip WHATSAPP_PROVIDER=meta after business verification — no code changes."
          : "Official Meta Cloud API. Set WHATSAPP_PROVIDER=evolution to run on a self-hosted Evolution server instead.",
      blocking: false,
    },
    ...(transport === "meta"
      ? [
          {
            id: "verify_token",
            label: "Webhook verify token",
            state: isSet("WHATSAPP_VERIFY_TOKEN") ? "ok" : "missing",
            detail: isSet("WHATSAPP_VERIFY_TOKEN")
              ? "Set. Use the same string in the Meta webhook config."
              : "You invent this string, then paste the same one into Meta.",
            blocking: true,
          } satisfies Check,
          {
            id: "app_secret",
            label: "Webhook signature verification",
            state: isSet("WHATSAPP_APP_SECRET") ? "ok" : "missing",
            detail: isSet("WHATSAPP_APP_SECRET")
              ? "Incoming webhooks are HMAC-verified."
              : "Without this the webhook rejects everything — it fails closed by design.",
            blocking: true,
            fix: "Meta App → Settings → Basic → App Secret → Show",
          } satisfies Check,
        ]
      : [
          {
            id: "webhook_token",
            label: "Evolution webhook token",
            state: isSet("EVOLUTION_WEBHOOK_TOKEN") ? "ok" : "missing",
            detail: isSet("EVOLUTION_WEBHOOK_TOKEN")
              ? "Set. Configure Evolution's webhook URL as /api/osf/evolution?token=<this value>."
              : "Invent one (openssl rand -hex 32). It authenticates the Evolution server's posts.",
            blocking: true,
          } satisfies Check,
        ]),
    {
      id: "voice",
      label: "Voice note transcription",
      state: isSet("GROQ_API_KEY") ? "ok" : "missing",
      detail: isSet("GROQ_API_KEY")
        ? "Whisper via Groq. Customers can send voice notes in any language."
        : "Needs GROQ_API_KEY. Without it a voice note can only be answered by asking the customer to type.",
      // Not blocking: text chat works fine without it.
      blocking: false,
    },
    // On Meta the webhook caller is Meta's cloud, so localhost is fatal. On
    // Evolution the caller is your own server — when that server runs on this
    // same machine (local Docker), host.docker.internal is exactly right and
    // must not block go-live.
    ...(transport === "evolution" && /localhost|host\.docker\.internal/.test(optional("NEXT_PUBLIC_APP_URL"))
      ? [
          {
            id: "public_url",
            label: "App URL (local mode)",
            state: "ok",
            detail:
              "Local test mode: the Evolution server on this machine reaches the app directly. When Evolution moves to a VPS, set NEXT_PUBLIC_APP_URL to the deployed https URL.",
            blocking: false,
          } satisfies Check,
        ]
      : [
          {
            id: "public_url",
            label: "Publicly reachable URL",
            state: optional("NEXT_PUBLIC_APP_URL").startsWith("https://") ? "ok" : "missing",
            detail: optional("NEXT_PUBLIC_APP_URL").startsWith("https://")
              ? optional("NEXT_PUBLIC_APP_URL")
              : "Currently localhost. The webhook caller can only reach a public HTTPS URL, which also serves brochure links.",
            blocking: true,
            fix: "Deploy, or tunnel with: npx ngrok http 3000",
          } satisfies Check,
        ]),
    {
      id: "handoff",
      label: "Hot-lead alerts",
      state: isSet("SALES_TEAM_WHATSAPP") ? "ok" : "missing",
      detail: isSet("SALES_TEAM_WHATSAPP")
        ? `Alerts go to +${optional("SALES_TEAM_WHATSAPP")}`
        : "No rep number set — handoffs are recorded in the CRM but nobody is pinged.",
      blocking: false,
    },
  ];

  const [transportCheck, kb, platform] = await Promise.all([
    transport === "evolution" ? verifyEvolution() : verifyPhoneNumber(),
    checkKnowledgeBase(),
    checkPlatformFunctions(),
  ]);
  const checks = [kb, platform, ...staticChecks, transportCheck];
  const blocking = checks.filter((c) => c.blocking && c.state !== "ok");

  return { checks, ready: blocking.length === 0, blockingCount: blocking.length };
}
