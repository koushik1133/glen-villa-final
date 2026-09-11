/**
 * WHITE-LABEL TEXT GUARD.
 *
 * Clients see what a setting *means*, not what it is called in the server
 * environment. "META_APP_SECRET is unset" tells a villa sales manager nothing
 * and tells anyone reading over their shoulder exactly which credential to go
 * looking for; "Message verification — not configured" carries the same status
 * signal with none of the infrastructure.
 *
 * The people who administer an install still need the real names. They get them
 * through the escape hatch the earlier white-labelling pass introduced:
 * `SHOW_VENDOR_DIAGNOSTICS=1`, set on the vendor's own deployments and absent
 * from the client's. This module is the single place that decision is made.
 *
 * Env-var names in *server* code (`process.env.X`) are not a defect — only text
 * that reaches a screen is, and that is what `operatorText` sanitises.
 */

/** True on a vendor-operated deployment, where raw setting names may be shown. */
export function showOperatorDetail(): boolean {
  return process.env.SHOW_VENDOR_DIAGNOSTICS === "1";
}

/**
 * What each environment variable *is*, in the words of someone who runs a
 * villa business. Keys are grouped by the product they belong to rather than by
 * the vendor that happens to provide it.
 */
const SETTING_LABELS: Record<string, string> = {
  // Database & sign-in
  OSF_SUPABASE_URL: "the database address",
  NEXT_PUBLIC_SUPABASE_URL: "the database address",
  OSF_SUPABASE_SERVICE_ROLE_KEY: "the database admin key",
  SUPABASE_SERVICE_ROLE_KEY: "the database admin key",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "the database access key",
  DASHBOARD_PASSWORD: "the console password",
  AUTH_MODE: "the sign-in mode",

  // AI writer
  GROQ_API_KEY: "the AI writer key",
  GROQ_API_KEY_FALLBACK: "the backup AI writer key",
  GROQ_MODEL: "the AI writer model",
  ANTHROPIC_API_KEY: "the AI writer key",
  ANTHROPIC_MODEL: "the AI writer model",
  GEMINI_API_KEY: "the AI writer key",
  AI_PROVIDER: "the AI writer selection",
  LLM_PROVIDER: "the AI writer selection",

  // WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: "the WhatsApp business number",
  WHATSAPP_ACCESS_TOKEN: "the WhatsApp access token",
  META_SYSTEM_USER_TOKEN: "the WhatsApp access token",
  WHATSAPP_VERIFY_TOKEN: "the webhook verification word",
  WHATSAPP_APP_SECRET: "the message signature secret",
  META_APP_SECRET: "the message signature secret",
  WHATSAPP_API_VERSION: "the messaging API version",
  WHATSAPP_PROVIDER: "the messaging route",
  SALES_TEAM_WHATSAPP: "the sales handoff number",
  EVOLUTION_API_URL: "the messaging server address",
  EVOLUTION_API_KEY: "the messaging server key",
  EVOLUTION_INSTANCE: "the messaging session name",
  EVOLUTION_WEBHOOK_TOKEN: "the messaging webhook token",
  EVOLUTION_TRIGGER_WORD: "the messaging trigger word",
  EVOLUTION_IGNORE_BEFORE: "the messaging cut-off date",

  // Public address
  PUBLIC_BASE_URL: "the public web address",
  NEXT_PUBLIC_APP_URL: "the public web address",

  // Social & advertising connections
  META_APP_ID: "the social app id",
  META_AD_ACCOUNT_ID: "the ad account",
  GOOGLE_CLIENT_ID: "the Google connection id",
  GOOGLE_CLIENT_SECRET: "the Google connection secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "the Google Ads token",
  GOOGLE_ADS_CLIENT_ID: "the Google Ads connection id",
  GOOGLE_ADS_CLIENT_SECRET: "the Google Ads connection secret",
  LINKEDIN_CLIENT_ID: "the LinkedIn connection id",
  LINKEDIN_CLIENT_SECRET: "the LinkedIn connection secret",
  TIKTOK_CLIENT_KEY: "the TikTok connection id",
  TIKTOK_CLIENT_SECRET: "the TikTok connection secret",
  X_CLIENT_ID: "the X connection id",
  X_CLIENT_SECRET: "the X connection secret",

  // Everything else
  UPLOAD_POST_API_KEY: "the publishing connector key",
  UPLOAD_POST_USER: "the publishing connector account",
  N8N_VIDEO_FORM_URL: "the publishing workflow address",
  N8N_WEBHOOK_SECRET: "the publishing workflow secret",
  BOLNA_API_KEY: "the voice agent key",
  RESEND_API_KEY: "the email delivery key",
  CRON_SECRET: "the scheduled-job secret",
  WORKER_SECRET: "the background worker secret",
  SHOW_VENDOR_DIAGNOSTICS: "the diagnostics switch",
};

/** Plain-language name for one environment variable. */
export function settingLabel(name: string): string {
  return SETTING_LABELS[name] ?? "a required setting";
}

/** `SCREAMING_SNAKE` with at least one underscore — how env vars are spelled. */
const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
/** Where secrets and schema live on the server. None of it is the client's business. */
const SECRET_PATHS: Array<[RegExp, string]> = [
  [/\b(?:supabase\/migrations\/)?\d{3,4}_[\w-]+\.sql\b/g, "the database setup script"],
  [/\bsupabase\/migrations\/[\w./-]+/g, "the database setup script"],
  [/\bnpm run [\w:-]+/g, "the provisioning script"],
  [/\bnpx [\w@/.-]+(?: [\w:/.-]+)*/g, "a tunnelling tool"],
  [/(?:^|[\s(])\.env(?:\.local)?\b/g, " the server configuration"],
  [/\bsrc\/lib\/[\w./-]+/g, "the server code"],
];

/**
 * Strip infrastructure names out of a line of status text, keeping the sentence
 * readable. Used at the point text is rendered, so the same status strings can
 * still carry full detail on a vendor deployment.
 */
export function redactOperatorText(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATHS) out = out.replace(re, replacement);
  out = out.replace(ENV_NAME, (m) => settingLabel(m));
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Full detail for the vendor, plain language for everyone else. */
export function operatorText(text: string): string {
  return showOperatorDetail() ? text : redactOperatorText(text);
}

/**
 * A provider-internal id (phone number id, WABA id, app id, instance id) never
 * belongs on a client screen; it identifies the vendor's own account. Returns
 * the id only on a vendor deployment.
 */
export function operatorId(id: string | null | undefined): string | null {
  return showOperatorDetail() && id ? id : null;
}

/**
 * Two-audience help text.
 *
 * A screen written for both readers keeps the plain sentence inline and the
 * operator sentence here, so no component file carries a variable name at all —
 * which is what `tests/whitelabel.test.ts` enforces.
 */
const OPERATOR_NOTES: Record<string, string> = {
  whatsappVerifyToken:
    "The value of WHATSAPP_VERIFY_TOKEN in your .env.local — type the same string into Meta.",
  whatsappPublicUrl:
    "Set NEXT_PUBLIC_APP_URL to that same https URL, or brochure links the agent sends will point at localhost and fail when WhatsApp tries to fetch them.",
};

/** The operator's wording on a vendor deployment, `plain` everywhere else. */
export function operatorNote(key: keyof typeof OPERATOR_NOTES | string, plain: string): string {
  return (showOperatorDetail() && OPERATOR_NOTES[key]) || plain;
}
