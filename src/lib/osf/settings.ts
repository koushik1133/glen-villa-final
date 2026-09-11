import { configStatus } from "./env";
import { db } from "./supabase";

/**
 * Organisation settings: the tenant record, the descriptive role matrix, the
 * publishing channel catalogue, and integration state.
 *
 * The load-bearing idea in this file is that integration state is DERIVED, not
 * stored. `villa_integrations.is_connected` is a boolean somebody wrote once;
 * it goes stale the moment a key is rotated out of the environment. Every
 * status shown to a user comes from `liveState()`, which reads the environment
 * on each request. The stored row is displayed only as "what the database
 * remembers", and the UI flags the disagreement rather than picking a winner.
 *
 * Schema: supabase/migrations/001_schema.sql.
 */

export type WriteResult = { ok: true; id?: string } | { ok: false; error: string };

// -----------------------------------------------------------------------------
// Environment probing
// -----------------------------------------------------------------------------

/**
 * Same placeholder rule as lib/env.ts: an unedited `<your-key-here>` from
 * .env.example is not a credential. Duplicated rather than imported because
 * env.ts exposes only typed getters that throw, and this needs to ask about
 * variables (CRON_SECRET, SESSION_SECRET) that have no getter there.
 */
export function envSet(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const value = raw.trim();
  if (value === "") return false;
  return !(value.startsWith("<") && value.endsWith(">"));
}

// -----------------------------------------------------------------------------
// Tenant
// -----------------------------------------------------------------------------

export interface Tenant {
  id: string;
  org_name: string;
  legal_entity: string | null;
  logo_url: string | null;
  currency: string;
  timezone: string;
  primary_phone: string | null;
  primary_email: string | null;
  address: string | null;
  website: string | null;
  is_active: boolean;
  updated_at: string;
}

/** Null when the row has never been created — the settings page offers to create it. */
export async function loadTenant(): Promise<Tenant | null> {
  const { data } = await db()
    .from("villa_tenant")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Tenant) ?? null;
}

export interface TenantPatch {
  orgName?: string;
  legalEntity?: string;
  logoUrl?: string;
  currency?: string;
  timezone?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  address?: string;
  website?: string;
}

/** Web links are echoed into ad previews and the logo into an <img>, so scheme is checked. */
function webUrl(value: string | undefined, label: string): string | null | { error: string } {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: `${label} must start with http:// or https://` };
    }
    return url.href;
  } catch {
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
function logoRef(value: string | undefined): string | null | { error: string } {
  if (value === undefined || value === "") return null;

  if (value.startsWith("/os")) {
    // `//host` is protocol-relative, i.e. a remote origin wearing a path's clothes.
    if (value.startsWith("//")) return { error: "Logo path must not start with //" };
    if (/[\t\n\r\\]/.test(value)) return { error: "Logo path contains an illegal character" };
    return value;
  }

  return webUrl(value, "Logo URL");
}

/** True when the browser will actually load this reference under the console's CSP. */
export function logoIsSameOrigin(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("/os") && !value.startsWith("//");
}

function optionalText(value: string | undefined, max: number, label: string): string | null | { error: string } {
  if (value === undefined || value === "") return null;
  if (value.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return value;
}

/**
 * Creates the single tenant row on first save, updates it thereafter.
 *
 * Not an upsert on a fixed id: the schema defaults the primary key to a random
 * uuid, so pinning one here would fight the migration and silently create a
 * second row on any deployment that already seeded one.
 */
export async function saveTenant(patch: TenantPatch): Promise<WriteResult> {
  const orgName = patch.orgName?.trim();
  if (!orgName) return { ok: false, error: "Organisation name is required" };
  if (orgName.length > 120) return { ok: false, error: "Organisation name must be 120 characters or fewer" };

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
  if (website !== null && typeof website === "object") return { ok: false, error: website.error };

  const logo = logoRef(patch.logoUrl?.trim());
  if (logo !== null && typeof logo === "object") return { ok: false, error: logo.error };

  const legal = optionalText(patch.legalEntity?.trim(), 160, "Legal entity");
  if (legal !== null && typeof legal === "object") return { ok: false, error: legal.error };

  const address = optionalText(patch.address?.trim(), 500, "Address");
  if (address !== null && typeof address === "object") return { ok: false, error: address.error };

  const phone = optionalText(patch.primaryPhone?.trim(), 32, "Phone");
  if (phone !== null && typeof phone === "object") return { ok: false, error: phone.error };

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

  const supabase = db();
  const existing = await loadTenant();

  if (!existing) {
    const { data, error } = await supabase.from("villa_tenant").insert(row).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id };
  }

  const { error } = await supabase.from("villa_tenant").update(row).eq("id", existing.id);
  if (error) return { ok: false, error: error.message };
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
export const USER_ROLES = [
  "super_admin",
  "sales_director",
  "sales_manager",
  "property_consultant",
  "marketing_manager",
  "marketing_agent",
  "viewer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

const ROLE_SET = new Set<string>(USER_ROLES);

export function isUserRole(value: string | undefined): value is UserRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  sales_director: "Sales Director",
  sales_manager: "Sales Manager",
  property_consultant: "Property Consultant",
  marketing_manager: "Marketing Manager",
  marketing_agent: "Marketing Agent",
  viewer: "Viewer",
};

export const USER_ROLE_BLURBS: Record<UserRole, string> = {
  super_admin: "Owns the account. Everything, including keys.",
  sales_director: "Owns the number. Sees every lead and every rep.",
  sales_manager: "Runs a pod. Reassigns leads, closes bookings.",
  property_consultant: "Works their own leads end to end.",
  marketing_manager: "Owns spend, creative and the channel switches.",
  marketing_agent: "Produces creative; a manager queues it.",
  viewer: "Read-only. For investors and auditors.",
};

export const DEPARTMENTS = ["sales", "marketing", "operations", "management"] as const;

export interface Capability {
  key: string;
  label: string;
  /** Why the capability is sensitive, shown as a column tooltip. */
  detail: string;
}

export const CAPABILITIES: Capability[] = [
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

export type Grant = "full" | "own" | "none";

/**
 * Role × capability. `own` means the capability is limited to records the
 * person is assigned to.
 */
export const ROLE_MATRIX: Record<UserRole, Record<string, Grant>> = {
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

export interface TeamRosterMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  department: string;
  is_active: boolean;
  accepts_leads: boolean;
  quota_inr: number | null;
  languages: string[] | null;
  joined_at: string;
}

export async function listRoster(): Promise<TeamRosterMember[]> {
  const { data } = await db()
    .from("villa_team_members")
    .select("id, name, email, phone, role, department, is_active, accepts_leads, quota_inr, languages, joined_at")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as TeamRosterMember[];
}

export interface NewMember {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
  acceptsLeads?: boolean;
}

/**
 * Adds a roster entry.
 *
 * lib/team.ts has a createTeamMember too, but it validates against a role list
 * that predates the villa_user_role enum — 'sales_agent' is not a member of
 * that enum, so its insert fails at the database. This validates against the
 * enum the column actually declares.
 */
export async function addMember(input: NewMember): Promise<WriteResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > 120) return { ok: false, error: "Name must be 120 characters or fewer" };

  const role = input.role?.trim() || "property_consultant";
  if (!isUserRole(role)) return { ok: false, error: `Unknown role: ${role}` };

  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That email address doesn't look valid" };
  }

  const department =
    input.department?.trim() || (role.startsWith("marketing") ? "marketing" : "sales");

  const { data, error } = await db()
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
    if (error.code === "23505") return { ok: false, error: `${email} is already on the roster` };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function setMemberRole(id: string, role: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Team member is required" };
  if (!isUserRole(role)) return { ok: false, error: `Unknown role: ${role}` };

  const { error } = await db().from("villa_team_members").update({ role }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// -----------------------------------------------------------------------------
// Publishing channels
// -----------------------------------------------------------------------------

export interface ChannelDef {
  channel: string;
  label: string;
  /** What switching it on actually does today. */
  effect: string;
}

/**
 * The channels a draft can be queued against.
 *
 * Enabling one adds it to the manual posting queue on /marketing/studio. None
 * of them causes an API call — see `queuePublish` in lib/marketing/studio.ts.
 */
export const CHANNEL_CATALOGUE: ChannelDef[] = [
  { channel: "instagram", label: "Instagram", effect: "Queues the caption for someone to paste into Instagram." },
  { channel: "facebook", label: "Facebook Page", effect: "Queues the post for a human to publish on the Page." },
  { channel: "whatsapp", label: "WhatsApp broadcast", effect: "Queues the copy for a broadcast list or Status." },
  { channel: "youtube", label: "YouTube Shorts", effect: "Queues the reel script for an editor." },
  { channel: "meta_ads", label: "Meta Ads", effect: "Queues ad copy for someone to paste into Ads Manager." },
  { channel: "google_ads", label: "Google Ads", effect: "Queues the RSA copy for Google Ads." },
  { channel: "email", label: "Email", effect: "Queues the copy for your email tool." },
];

export interface ChannelRow extends ChannelDef {
  enabled: boolean;
  credential_status: string;
  notes: string | null;
  /** False when no villa_channel_settings row exists yet. */
  stored: boolean;
}

/**
 * The catalogue joined onto whatever is stored, so a channel the migration
 * never seeded still renders with a working switch instead of vanishing.
 */
export async function channelRows(): Promise<ChannelRow[]> {
  const { data } = await db()
    .from("villa_channel_settings")
    .select("channel, label, enabled, credential_status, notes");

  const stored = new Map(
    ((data ?? []) as Array<{
      channel: string;
      label: string;
      enabled: boolean;
      credential_status: string;
      notes: string | null;
    }>).map((row) => [row.channel, row]),
  );

  const rows: ChannelRow[] = CHANNEL_CATALOGUE.map((def) => {
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

export async function setChannelEnabled(channel: string, enabled: boolean): Promise<WriteResult> {
  const key = channel.trim();
  if (!key) return { ok: false, error: "Channel is required" };

  const def = CHANNEL_CATALOGUE.find((c) => c.channel === key);
  const { error } = await db()
    .from("villa_channel_settings")
    .upsert(
      {
        channel: key,
        label: def?.label ?? key,
        enabled,
        // Deliberately never written as 'connected': nothing in this app holds
        // a posting credential for any of these channels.
        credential_status: "not_connected",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: key };
}

// -----------------------------------------------------------------------------
// Integrations
// -----------------------------------------------------------------------------

export type IntegrationState = "connected" | "not_configured" | "unavailable";

export interface IntegrationDef {
  provider: string;
  label: string;
  category: string;
  /** What this app does with it, in one line. */
  role: string;
  /** All of these must be present for the integration to read as connected. */
  envVars: string[];
  /** Heading in SETUP-GUIDE.md. */
  guide: string;
  /**
   * Set when this app contains no code path that calls the provider. Such an
   * integration can never be "connected" no matter what any table says.
   */
  unavailable?: string;
  /** Extra caveat shown even when the credentials are present. */
  caveat?: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
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
    caveat:
      "Keys present only means this app can call Meta. Whether the webhook is subscribed and the number is live is decided in Meta's dashboard, not here.",
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
    unavailable:
      "Not built. There is no Marketing API client in this codebase and no credential for one. Campaign spend on /marketing/campaigns is typed in by hand.",
  },
  {
    provider: "google_ads",
    label: "Google Ads",
    category: "Advertising",
    role: "Would pull search spend and conversions automatically.",
    envVars: [],
    guide: "11. What this will cost",
    unavailable:
      "Not built. No Google Ads client, developer token or OAuth flow exists here. Spend is typed in by hand.",
  },
  {
    provider: "social_publishing",
    label: "Instagram / Facebook publishing",
    category: "Advertising",
    role: "Would post an approved draft straight to the Page or profile.",
    envVars: [],
    guide: "7.5 Going live to real customers",
    unavailable:
      "Not built. /api/marketing/publish writes a queue row and calls no platform API — a queued draft is a to-do for a person.",
  },
];

export interface IntegrationStatus extends IntegrationDef {
  state: IntegrationState;
  missing: string[];
  /** What villa_integrations remembers, if anything. */
  storedConnected: boolean | null;
  storedStatus: string | null;
  storedError: string | null;
  lastSyncAt: string | null;
  /** True when the stored boolean contradicts what the environment shows now. */
  stale: boolean;
}

function liveState(def: IntegrationDef): { state: IntegrationState; missing: string[] } {
  if (def.unavailable) return { state: "unavailable", missing: [] };
  const missing = def.envVars.filter((name) => !envSet(name));
  return { state: missing.length === 0 ? "connected" : "not_configured", missing };
}

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const { data } = await db()
    .from("villa_integrations")
    .select("provider, is_connected, status, last_sync_at, error_message");

  const stored = new Map(
    ((data ?? []) as Array<{
      provider: string;
      is_connected: boolean;
      status: string;
      last_sync_at: string | null;
      error_message: string | null;
    }>).map((row) => [row.provider, row]),
  );

  return INTEGRATIONS.map((def) => {
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
export async function syncIntegrationRecords(): Promise<WriteResult> {
  const now = new Date().toISOString();

  const rows = INTEGRATIONS.map((def) => {
    const { state, missing } = liveState(def);
    return {
      provider: def.provider,
      label: def.label,
      category: def.category,
      is_connected: state === "connected",
      status: state === "connected" ? "connected" : state === "unavailable" ? "not_implemented" : "disconnected",
      last_sync_at: now,
      error_message:
        state === "unavailable"
          ? def.unavailable ?? null
          : missing.length > 0
            ? `Missing: ${missing.join(", ")}`
            : null,
      updated_at: now,
    };
  });

  const { error } = await db().from("villa_integrations").upsert(rows, { onConflict: "provider" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Convenience for pages that just need the three AI/data flags. */
export function coreConfig() {
  const status = configStatus();
  return { ...status, gemini: envSet("GEMINI_API_KEY") };
}
