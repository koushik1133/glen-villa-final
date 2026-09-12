"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTEGRATIONS = exports.CHANNEL_CATALOGUE = exports.ROLE_MATRIX = exports.CAPABILITIES = exports.DEPARTMENTS = exports.USER_ROLE_BLURBS = exports.USER_ROLE_LABELS = exports.USER_ROLES = void 0;
exports.envSet = envSet;
exports.loadTenant = loadTenant;
exports.logoIsSameOrigin = logoIsSameOrigin;
exports.saveTenant = saveTenant;
exports.isUserRole = isUserRole;
exports.listRoster = listRoster;
exports.addMember = addMember;
exports.setMemberRole = setMemberRole;
exports.channelRows = channelRows;
exports.setChannelEnabled = setChannelEnabled;
exports.integrationStatuses = integrationStatuses;
exports.syncIntegrationRecords = syncIntegrationRecords;
exports.coreConfig = coreConfig;
const env_1 = require("./env");
const supabase_1 = require("./supabase");
// -----------------------------------------------------------------------------
// Environment probing
// -----------------------------------------------------------------------------
/**
 * Same placeholder rule as lib/env.ts: an unedited `<your-key-here>` from
 * .env.example is not a credential. Duplicated rather than imported because
 * env.ts exposes only typed getters that throw, and this needs to ask about
 * variables (CRON_SECRET, SESSION_SECRET) that have no getter there.
 */
function envSet(name) {
    const raw = process.env[name];
    if (!raw)
        return false;
    const value = raw.trim();
    if (value === "")
        return false;
    return !(value.startsWith("<") && value.endsWith(">"));
}
/** Null when the row has never been created — the settings page offers to create it. */
async function loadTenant() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_tenant")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return data ?? null;
}
/** Web links are echoed into ad previews and the logo into an <img>, so scheme is checked. */
function webUrl(value, label) {
    if (value === undefined || value === "")
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return { error: `${label} must start with http:// or https://` };
        }
        return url.href;
    }
    catch {
        return { error: `${label} isn't a valid link` };
    }
}
/**
 * The logo reference, which is not simply a URL.
 *
 * next.config.ts sets `img-src 'self' data: blob:`, so a remote logo would be
 * blocked by the browser and render as a broken image inside the console. A
 * same-origin path — a file dropped in `public/` — is the only reference that
 * actually displays, so it is accepted alongside a full URL rather than being
 * rejected by a URL parser. A remote URL is still stored (it is the right value
 * for a brochure or an export), and the UI says why it is not drawn here.
 */
function logoRef(value) {
    if (value === undefined || value === "")
        return null;
    if (value.startsWith("/")) {
        // `//host` is protocol-relative, i.e. a remote origin wearing a path's clothes.
        if (value.startsWith("//"))
            return { error: "Logo path must not start with //" };
        if (/[\t\n\r\\]/.test(value))
            return { error: "Logo path contains an illegal character" };
        return value;
    }
    return webUrl(value, "Logo URL");
}
/** True when the browser will actually load this reference under the console's CSP. */
function logoIsSameOrigin(value) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}
function optionalText(value, max, label) {
    if (value === undefined || value === "")
        return null;
    if (value.length > max)
        return { error: `${label} must be ${max} characters or fewer` };
    return value;
}
/**
 * Creates the single tenant row on first save, updates it thereafter.
 *
 * Not an upsert on a fixed id: the schema defaults the primary key to a random
 * uuid, so pinning one here would fight the migration and silently create a
 * second row on any deployment that already seeded one.
 */
async function saveTenant(patch) {
    const orgName = patch.orgName?.trim();
    if (!orgName)
        return { ok: false, error: "Organisation name is required" };
    if (orgName.length > 120)
        return { ok: false, error: "Organisation name must be 120 characters or fewer" };
    const currency = (patch.currency ?? "INR").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        return { ok: false, error: "Currency must be a three-letter code such as INR" };
    }
    const timezone = (patch.timezone ?? "Asia/Kolkata").trim();
    if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(timezone)) {
        return { ok: false, error: "Timezone must look like Asia/Kolkata" };
    }
    const email = patch.primaryEmail?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "That email address doesn't look valid" };
    }
    const website = webUrl(patch.website?.trim(), "Website");
    if (website !== null && typeof website === "object")
        return { ok: false, error: website.error };
    const logo = logoRef(patch.logoUrl?.trim());
    if (logo !== null && typeof logo === "object")
        return { ok: false, error: logo.error };
    const legal = optionalText(patch.legalEntity?.trim(), 160, "Legal entity");
    if (legal !== null && typeof legal === "object")
        return { ok: false, error: legal.error };
    const address = optionalText(patch.address?.trim(), 500, "Address");
    if (address !== null && typeof address === "object")
        return { ok: false, error: address.error };
    const phone = optionalText(patch.primaryPhone?.trim(), 32, "Phone");
    if (phone !== null && typeof phone === "object")
        return { ok: false, error: phone.error };
    const row = {
        org_name: orgName,
        legal_entity: legal,
        logo_url: logo,
        currency,
        timezone,
        primary_phone: phone,
        primary_email: email || null,
        address,
        website,
        updated_at: new Date().toISOString(),
    };
    const supabase = (0, supabase_1.db)();
    const existing = await loadTenant();
    if (!existing) {
        const { data, error } = await supabase.from("villa_tenant").insert(row).select("id").single();
        if (error)
            return { ok: false, error: error.message };
        return { ok: true, id: data.id };
    }
    const { error } = await supabase.from("villa_tenant").update(row).eq("id", existing.id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: existing.id };
}
// -----------------------------------------------------------------------------
// Roles — descriptive metadata, NOT enforcement
// -----------------------------------------------------------------------------
/**
 * The villa_user_role enum, verbatim from the migration.
 *
 * lib/team.ts carries a different, older list ('owner', 'admin', 'sales_agent'
 * …) that no longer matches the enum. These are the values the column will
 * actually accept, so roster writes on this page use them.
 */
exports.USER_ROLES = [
    "super_admin",
    "sales_director",
    "sales_manager",
    "property_consultant",
    "marketing_manager",
    "marketing_agent",
    "viewer",
];
const ROLE_SET = new Set(exports.USER_ROLES);
function isUserRole(value) {
    return typeof value === "string" && ROLE_SET.has(value);
}
exports.USER_ROLE_LABELS = {
    super_admin: "Super Admin",
    sales_director: "Sales Director",
    sales_manager: "Sales Manager",
    property_consultant: "Property Consultant",
    marketing_manager: "Marketing Manager",
    marketing_agent: "Marketing Agent",
    viewer: "Viewer",
};
exports.USER_ROLE_BLURBS = {
    super_admin: "Owns the account. Everything, including keys.",
    sales_director: "Owns the number. Sees every lead and every rep.",
    sales_manager: "Runs a pod. Reassigns leads, closes bookings.",
    property_consultant: "Works their own leads end to end.",
    marketing_manager: "Owns spend, creative and the channel switches.",
    marketing_agent: "Produces creative; a manager queues it.",
    viewer: "Read-only. For investors and auditors.",
};
exports.DEPARTMENTS = ["sales", "marketing", "operations", "management"];
exports.CAPABILITIES = [
    { key: "view_reports", label: "View reports", detail: "Dashboards, funnel, revenue and analytics pages." },
    { key: "view_leads", label: "View all leads", detail: "Every lead record and full WhatsApp transcript." },
    { key: "edit_leads", label: "Edit & reassign leads", detail: "Change stage, score overrides and lead ownership." },
    { key: "reply_inbox", label: "Reply in inbox", detail: "Send a WhatsApp message to a customer as the business." },
    { key: "manage_bookings", label: "Manage bookings", detail: "Create bookings and record payments against them." },
    { key: "manage_inventory", label: "Manage inventory", detail: "Change unit status and unit pricing." },
    { key: "record_spend", label: "Record ad spend", detail: "Type in campaign spend, impressions and clicks." },
    { key: "generate_content", label: "Generate content", detail: "Run the content studio and save drafts." },
    { key: "queue_publish", label: "Queue for posting", detail: "Put a draft into the manual publishing queue." },
    { key: "manage_team", label: "Manage team", detail: "Add people and change their role." },
    { key: "manage_integrations", label: "Manage integrations", detail: "Channel switches and API credentials." },
    { key: "export_data", label: "Export customer data", detail: "Download names, phone numbers and conversations." },
];
/**
 * Role × capability. `own` means the capability is limited to records the
 * person is assigned to.
 */
exports.ROLE_MATRIX = {
    super_admin: {
        view_reports: "full", view_leads: "full", edit_leads: "full", reply_inbox: "full",
        manage_bookings: "full", manage_inventory: "full", record_spend: "full",
        generate_content: "full", queue_publish: "full", manage_team: "full",
        manage_integrations: "full", export_data: "full",
    },
    sales_director: {
        view_reports: "full", view_leads: "full", edit_leads: "full", reply_inbox: "full",
        manage_bookings: "full", manage_inventory: "full", record_spend: "none",
        generate_content: "full", queue_publish: "none", manage_team: "full",
        manage_integrations: "none", export_data: "full",
    },
    sales_manager: {
        view_reports: "full", view_leads: "full", edit_leads: "full", reply_inbox: "full",
        manage_bookings: "full", manage_inventory: "none", record_spend: "none",
        generate_content: "none", queue_publish: "none", manage_team: "none",
        manage_integrations: "none", export_data: "full",
    },
    property_consultant: {
        view_reports: "own", view_leads: "own", edit_leads: "own", reply_inbox: "own",
        manage_bookings: "own", manage_inventory: "none", record_spend: "none",
        generate_content: "none", queue_publish: "none", manage_team: "none",
        manage_integrations: "none", export_data: "none",
    },
    marketing_manager: {
        view_reports: "full", view_leads: "full", edit_leads: "none", reply_inbox: "none",
        manage_bookings: "none", manage_inventory: "none", record_spend: "full",
        generate_content: "full", queue_publish: "full", manage_team: "none",
        manage_integrations: "full", export_data: "none",
    },
    marketing_agent: {
        view_reports: "full", view_leads: "none", edit_leads: "none", reply_inbox: "none",
        manage_bookings: "none", manage_inventory: "none", record_spend: "none",
        generate_content: "full", queue_publish: "none", manage_team: "none",
        manage_integrations: "none", export_data: "none",
    },
    viewer: {
        view_reports: "full", view_leads: "full", edit_leads: "none", reply_inbox: "none",
        manage_bookings: "none", manage_inventory: "none", record_spend: "none",
        generate_content: "none", queue_publish: "none", manage_team: "none",
        manage_integrations: "none", export_data: "none",
    },
};
async function listRoster() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, email, phone, role, department, is_active, accepts_leads, quota_inr, languages, joined_at")
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });
    return (data ?? []);
}
/**
 * Adds a roster entry.
 *
 * lib/team.ts has a createTeamMember too, but it validates against a role list
 * that predates the villa_user_role enum — 'sales_agent' is not a member of
 * that enum, so its insert fails at the database. This validates against the
 * enum the column actually declares.
 */
async function addMember(input) {
    const name = input.name?.trim();
    if (!name)
        return { ok: false, error: "Name is required" };
    if (name.length > 120)
        return { ok: false, error: "Name must be 120 characters or fewer" };
    const role = input.role?.trim() || "property_consultant";
    if (!isUserRole(role))
        return { ok: false, error: `Unknown role: ${role}` };
    const email = input.email?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "That email address doesn't look valid" };
    }
    const department = input.department?.trim() || (role.startsWith("marketing") ? "marketing" : "sales");
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .insert({
        name,
        email: email || null,
        phone: input.phone?.trim() || null,
        role,
        department,
        accepts_leads: input.acceptsLeads ?? role !== "viewer",
    })
        .select("id")
        .single();
    if (error) {
        if (error.code === "23505")
            return { ok: false, error: `${email} is already on the roster` };
        return { ok: false, error: error.message };
    }
    return { ok: true, id: data.id };
}
async function setMemberRole(id, role) {
    if (!id)
        return { ok: false, error: "Team member is required" };
    if (!isUserRole(role))
        return { ok: false, error: `Unknown role: ${role}` };
    const { error } = await (0, supabase_1.db)().from("villa_team_members").update({ role }).eq("id", id);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id };
}
/**
 * The channels a draft can be queued against.
 *
 * Enabling one adds it to the manual posting queue on /marketing/studio. None
 * of them causes an API call — see `queuePublish` in lib/marketing/studio.ts.
 */
exports.CHANNEL_CATALOGUE = [
    { channel: "instagram", label: "Instagram", effect: "Queues the caption for someone to paste into Instagram." },
    { channel: "facebook", label: "Facebook Page", effect: "Queues the post for a human to publish on the Page." },
    { channel: "whatsapp", label: "WhatsApp broadcast", effect: "Queues the copy for a broadcast list or Status." },
    { channel: "youtube", label: "YouTube Shorts", effect: "Queues the reel script for an editor." },
    { channel: "meta_ads", label: "Meta Ads", effect: "Queues ad copy for someone to paste into Ads Manager." },
    { channel: "google_ads", label: "Google Ads", effect: "Queues the RSA copy for Google Ads." },
    { channel: "email", label: "Email", effect: "Queues the copy for your email tool." },
];
/**
 * The catalogue joined onto whatever is stored, so a channel the migration
 * never seeded still renders with a working switch instead of vanishing.
 */
async function channelRows() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_channel_settings")
        .select("channel, label, enabled, credential_status, notes");
    const stored = new Map((data ?? []).map((row) => [row.channel, row]));
    const rows = exports.CHANNEL_CATALOGUE.map((def) => {
        const row = stored.get(def.channel);
        stored.delete(def.channel);
        return {
            ...def,
            enabled: row?.enabled ?? false,
            credential_status: row?.credential_status ?? "not_connected",
            notes: row?.notes ?? null,
            stored: Boolean(row),
        };
    });
    // Anything seeded into the table but absent from the catalogue still belongs
    // on the page — hiding it would leave an enabled channel nobody can switch off.
    for (const row of stored.values()) {
        rows.push({
            channel: row.channel,
            label: row.label || row.channel,
            effect: "Not in this build's catalogue — queued drafts will still record this channel name.",
            enabled: row.enabled,
            credential_status: row.credential_status,
            notes: row.notes,
            stored: true,
        });
    }
    return rows;
}
async function setChannelEnabled(channel, enabled) {
    const key = channel.trim();
    if (!key)
        return { ok: false, error: "Channel is required" };
    const def = exports.CHANNEL_CATALOGUE.find((c) => c.channel === key);
    const { error } = await (0, supabase_1.db)()
        .from("villa_channel_settings")
        .upsert({
        channel: key,
        label: def?.label ?? key,
        enabled,
        // Deliberately never written as 'connected': nothing in this app holds
        // a posting credential for any of these channels.
        credential_status: "not_connected",
        updated_at: new Date().toISOString(),
    }, { onConflict: "channel" });
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: key };
}
exports.INTEGRATIONS = [
    {
        provider: "supabase",
        label: "Supabase",
        category: "Data",
        role: "Stores every lead, message, booking and draft in this console.",
        envVars: ["OSF_SUPABASE_URL", "OSF_SUPABASE_SERVICE_ROLE_KEY"],
        guide: "3. Supabase — the database",
    },
    {
        provider: "whatsapp",
        label: "WhatsApp Cloud API",
        category: "Messaging",
        role: "Receives customer messages and sends the agent's replies.",
        envVars: [
            "WHATSAPP_PHONE_NUMBER_ID",
            "WHATSAPP_ACCESS_TOKEN",
            "WHATSAPP_VERIFY_TOKEN",
            "WHATSAPP_APP_SECRET",
        ],
        guide: "7. WhatsApp Cloud API (Meta) — the messaging channel",
        caveat: "Keys present only means this app can call Meta. Whether the webhook is subscribed and the number is live is decided in Meta's dashboard, not here.",
    },
    {
        provider: "anthropic",
        label: "Anthropic",
        category: "AI",
        role: "The production model behind the customer-facing agent.",
        envVars: ["ANTHROPIC_API_KEY"],
        guide: "5. Anthropic — the production AI",
    },
    {
        provider: "groq",
        label: "Groq",
        category: "AI",
        role: "Free-tier model used for testing the agent.",
        envVars: ["GROQ_API_KEY"],
        guide: "4. Groq — free AI, for testing",
    },
    {
        provider: "gemini",
        label: "Google Gemini",
        category: "AI",
        role: "Writes the copy in the content studio. Without it the studio falls back to a fixed template.",
        envVars: ["GEMINI_API_KEY"],
        guide: "6. Google Gemini — marketing copy (optional)",
    },
    {
        provider: "sales_handoff",
        label: "Sales handoff number",
        category: "Messaging",
        role: "Where a hot lead is escalated over WhatsApp.",
        envVars: ["SALES_TEAM_WHATSAPP"],
        guide: "7.3 Where to paste it all",
    },
    {
        provider: "console_auth",
        label: "Console password",
        category: "Security",
        role: "The shared password guarding every page of this console.",
        envVars: ["DASHBOARD_PASSWORD"],
        guide: "8. The three passwords you invent yourself",
    },
    {
        provider: "cron",
        label: "Follow-up cron secret",
        category: "Automation",
        role: "Bearer token the scheduled follow-up job must present.",
        envVars: ["CRON_SECRET"],
        guide: "10. Going live — deployment checklist",
    },
    {
        provider: "meta_ads",
        label: "Meta Ads",
        category: "Advertising",
        role: "Would pull spend, impressions and clicks automatically.",
        envVars: [],
        guide: "7. WhatsApp Cloud API (Meta) — the messaging channel",
        unavailable: "Not built. There is no Marketing API client in this codebase and no credential for one. Campaign spend on /marketing/campaigns is typed in by hand.",
    },
    {
        provider: "google_ads",
        label: "Google Ads",
        category: "Advertising",
        role: "Would pull search spend and conversions automatically.",
        envVars: [],
        guide: "11. What this will cost",
        unavailable: "Not built. No Google Ads client, developer token or OAuth flow exists here. Spend is typed in by hand.",
    },
    {
        provider: "social_publishing",
        label: "Instagram / Facebook publishing",
        category: "Advertising",
        role: "Would post an approved draft straight to the Page or profile.",
        envVars: [],
        guide: "7.5 Going live to real customers",
        unavailable: "Not built. /api/marketing/publish writes a queue row and calls no platform API — a queued draft is a to-do for a person.",
    },
];
function liveState(def) {
    if (def.unavailable)
        return { state: "unavailable", missing: [] };
    const missing = def.envVars.filter((name) => !envSet(name));
    return { state: missing.length === 0 ? "connected" : "not_configured", missing };
}
async function integrationStatuses() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_integrations")
        .select("provider, is_connected, status, last_sync_at, error_message");
    const stored = new Map((data ?? []).map((row) => [row.provider, row]));
    return exports.INTEGRATIONS.map((def) => {
        const { state, missing } = liveState(def);
        const row = stored.get(def.provider);
        return {
            ...def,
            state,
            missing,
            storedConnected: row ? row.is_connected : null,
            storedStatus: row ? row.status : null,
            storedError: row?.error_message ?? null,
            lastSyncAt: row?.last_sync_at ?? null,
            stale: row ? row.is_connected !== (state === "connected") : false,
        };
    });
}
/**
 * Rewrites villa_integrations to agree with the environment.
 *
 * Nothing reads the table for a decision — this exists so the stored row stops
 * contradicting the page, and so a deploy has a record of when each credential
 * was last observed present.
 */
async function syncIntegrationRecords() {
    const now = new Date().toISOString();
    const rows = exports.INTEGRATIONS.map((def) => {
        const { state, missing } = liveState(def);
        return {
            provider: def.provider,
            label: def.label,
            category: def.category,
            is_connected: state === "connected",
            status: state === "connected" ? "connected" : state === "unavailable" ? "not_implemented" : "disconnected",
            last_sync_at: now,
            error_message: state === "unavailable"
                ? def.unavailable ?? null
                : missing.length > 0
                    ? `Missing: ${missing.join(", ")}`
                    : null,
            updated_at: now,
        };
    });
    const { error } = await (0, supabase_1.db)().from("villa_integrations").upsert(rows, { onConflict: "provider" });
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
/** Convenience for pages that just need the three AI/data flags. */
function coreConfig() {
    const status = (0, env_1.configStatus)();
    return { ...status, gemini: envSet("GEMINI_API_KEY") };
}
