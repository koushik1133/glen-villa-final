"use strict";
/**
 * Environment access.
 *
 * Values are read lazily so that an unconfigured `.env.local` produces a clear,
 * actionable message at the point of use rather than a crash at import time.
 * That matters here: the dashboard should still render and tell you what's
 * missing before you've pasted your keys in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.required = required;
exports.optional = optional;
exports.configStatus = configStatus;
/** Placeholders left in `.env.example` — treated as "not configured". */
function isPlaceholder(value) {
    return value.startsWith("<") && value.endsWith(">");
}
function read(name) {
    const raw = process.env[name];
    if (!raw || raw.trim() === "" || isPlaceholder(raw.trim()))
        return undefined;
    return raw.trim();
}
/** Throws with a pointer to the exact line of `.env.local` that's missing. */
function required(name) {
    const value = read(name);
    if (!value) {
        throw new Error(`Missing environment variable ${name}. Open .env.local and set it — ` +
            `see .env.example for where to find the value.`);
    }
    return value;
}
function optional(name, fallback = "") {
    return read(name) ?? fallback;
}
exports.env = {
    /** Which LLM actually answers customers. See .env.example section 1. */
    get llmProvider() {
        return optional("LLM_PROVIDER", "anthropic") === "groq" ? "groq" : "anthropic";
    },
    get anthropicApiKey() {
        return required("ANTHROPIC_API_KEY");
    },
    get model() {
        return optional("ANTHROPIC_MODEL", "claude-opus-4-8");
    },
    get effort() {
        const e = optional("AGENT_EFFORT", "medium");
        return e === "low" || e === "high" ? e : "medium";
    },
    /** Free-tier test provider — see PHASE-2 doc for when to move off it. */
    get groqApiKey() {
        return required("GROQ_API_KEY");
    },
    /**
     * All Groq keys, primary first, then any fallbacks. The free tier caps each
     * key at 200K tokens/day; when the primary is exhausted the agent rotates to
     * the next key and keeps replying instead of dropping the message. Fallbacks
     * live in GROQ_API_KEY_FALLBACK as a comma-separated list.
     */
    get groqApiKeys() {
        const primary = required("GROQ_API_KEY");
        const fallbacks = (optional("GROQ_API_KEY_FALLBACK") ?? "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
        // De-dupe so an accidental repeat doesn't waste a rotation slot.
        return [...new Set([primary, ...fallbacks])];
    },
    get groqModel() {
        return optional("GROQ_MODEL", "openai/gpt-oss-120b");
    },
    get supabaseUrl() {
        return required("OSF_SUPABASE_URL");
    },
    get supabaseServiceKey() {
        return required("OSF_SUPABASE_SERVICE_ROLE_KEY");
    },
    get whatsappPhoneNumberId() {
        return required("WHATSAPP_PHONE_NUMBER_ID");
    },
    get whatsappAccessToken() {
        return required("WHATSAPP_ACCESS_TOKEN");
    },
    get whatsappVerifyToken() {
        return required("WHATSAPP_VERIFY_TOKEN");
    },
    get whatsappAppSecret() {
        return required("WHATSAPP_APP_SECRET");
    },
    get whatsappApiVersion() {
        return optional("WHATSAPP_API_VERSION", "v21.0");
    },
    /**
     * Which transport carries WhatsApp traffic.
     *
     * "meta"      — the official Cloud API (business-verified, template fees,
     *               ban-proof). The original path; nothing about it changed.
     * "evolution" — a self-hosted Evolution API server driving a normal
     *               WhatsApp account over the Web protocol (free, instant,
     *               unofficial). The interim path until business verification.
     *
     * Explicit WHATSAPP_PROVIDER always wins. Unset, it infers: Evolution vars
     * present and Meta's absent → evolution; anything else → meta, so existing
     * deployments keep their behaviour without editing anything.
     */
    get whatsappProvider() {
        const explicit = optional("WHATSAPP_PROVIDER")?.toLowerCase();
        if (explicit === "evolution" || explicit === "meta")
            return explicit;
        const hasEvolution = Boolean(optional("EVOLUTION_API_URL"));
        const hasMeta = Boolean(optional("WHATSAPP_ACCESS_TOKEN"));
        return hasEvolution && !hasMeta ? "evolution" : "meta";
    },
    get evolutionApiUrl() {
        // Trailing slash stripped so path joins can't produce //double-slashes.
        return required("EVOLUTION_API_URL").replace(/\/+$/, "");
    },
    get evolutionApiKey() {
        return required("EVOLUTION_API_KEY");
    },
    get evolutionInstance() {
        return required("EVOLUTION_INSTANCE");
    },
    get evolutionWebhookToken() {
        return required("EVOLUTION_WEBHOOK_TOKEN");
    },
    /**
     * Personal-number guard rails, both optional.
     *
     * When the linked number is someone's real WhatsApp (testing on a personal
     * SIM), the agent must not answer friends and family. TRIGGER_WORD makes it
     * respond only to messages that start with that word; IGNORE_BEFORE drops
     * anything older than the given date, so a history sync on first connect
     * can never replay old chats into the CRM. Unset both for a dedicated
     * business SIM.
     */
    get evolutionTriggerWord() {
        return optional("EVOLUTION_TRIGGER_WORD")?.trim().toLowerCase() || null;
    },
    get evolutionIgnoreBefore() {
        const raw = optional("EVOLUTION_IGNORE_BEFORE");
        if (!raw)
            return null;
        const ms = Date.parse(raw);
        return Number.isFinite(ms) ? ms : null;
    },
    /**
     * The linked WhatsApp number itself, digits only. Set this ONLY when you are
     * testing by messaging the linked number from itself (a "message yourself"
     * chat). It tells the webhook to treat fromMe messages in that self-chat as
     * real test input, while still ignoring the agent's own replies (matched by
     * message id). Leave unset in production, where the agent must never act on
     * any message it or a human sent from the business phone.
     */
    get evolutionSelfNumber() {
        const raw = optional("EVOLUTION_SELF_NUMBER");
        return raw ? raw.replace(/\D/g, "") : null;
    },
    // Instagram DMs run the same agent over Meta's Messenger transport. The
    // access token and app secret are usually the same app as WhatsApp, so both
    // fall back to the WhatsApp values rather than forcing a duplicate paste.
    get instagramAccountId() {
        return required("INSTAGRAM_ACCOUNT_ID");
    },
    get instagramAccessToken() {
        return optional("INSTAGRAM_ACCESS_TOKEN") || required("WHATSAPP_ACCESS_TOKEN");
    },
    get instagramVerifyToken() {
        return optional("INSTAGRAM_VERIFY_TOKEN") || required("WHATSAPP_VERIFY_TOKEN");
    },
    get instagramAppSecret() {
        return optional("INSTAGRAM_APP_SECRET") || required("WHATSAPP_APP_SECRET");
    },
    get salesTeamWhatsapp() {
        return optional("SALES_TEAM_WHATSAPP");
    },
    get salesTeamName() {
        return optional("SALES_TEAM_NAME", "our sales team");
    },
    get appUrl() {
        return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    },
    get dashboardPassword() {
        return optional("DASHBOARD_PASSWORD");
    },
    get projectMapsUrl() {
        return optional("PROJECT_MAPS_URL");
    },
    get brochureUrl() {
        return optional("BROCHURE_URL");
    },
    /** Ad/social copy generation. Optional — degrades to a template when unset. */
    get geminiApiKey() {
        return optional("GEMINI_API_KEY");
    },
};
/** Which integrations are wired up — drives the dashboard's setup checklist. */
function configStatus() {
    const llmProvider = optional("LLM_PROVIDER", "anthropic") === "groq" ? "groq" : "anthropic";
    const anthropic = Boolean(read("ANTHROPIC_API_KEY"));
    const groq = Boolean(read("GROQ_API_KEY"));
    return {
        llmProvider,
        anthropic,
        groq,
        /** Whichever provider is active actually has a key set. */
        aiConfigured: llmProvider === "groq" ? groq : anthropic,
        supabase: Boolean(read("OSF_SUPABASE_URL")) &&
            Boolean(read("OSF_SUPABASE_SERVICE_ROLE_KEY")),
        whatsapp: Boolean(read("WHATSAPP_PHONE_NUMBER_ID")) &&
            Boolean(read("WHATSAPP_ACCESS_TOKEN")) &&
            Boolean(read("WHATSAPP_APP_SECRET")) &&
            Boolean(read("WHATSAPP_VERIFY_TOKEN")),
        evolution: Boolean(read("EVOLUTION_API_URL")) &&
            Boolean(read("EVOLUTION_API_KEY")) &&
            Boolean(read("EVOLUTION_INSTANCE")),
        instagram: Boolean(read("INSTAGRAM_ACCOUNT_ID")) &&
            Boolean(read("INSTAGRAM_ACCESS_TOKEN") ?? read("WHATSAPP_ACCESS_TOKEN")),
        salesHandoff: Boolean(read("SALES_TEAM_WHATSAPP")),
    };
}
