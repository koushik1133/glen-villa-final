import { db } from "./supabase";

/**
 * Campaigns, marketing economics and multi-touch attribution.
 *
 * No ad-platform API is connected, so spend/impressions/clicks are whatever a
 * human last typed in. Every derived number below (CTR, CPL, ROAS) is only as
 * current as that entry — the UI says so rather than implying a live sync.
 * Tables and the villa_campaign_performance view: supabase/migrations/0009_business_os.sql.
 */

export type CampaignStatus = "active" | "paused" | "ended" | "draft";

/** Filter order, not enum order — this is what the status <select> renders. */
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["draft", "active", "paused", "ended"];

const STATUS_SET = new Set<string>(CAMPAIGN_STATUSES);

export function isCampaignStatus(value: string): value is CampaignStatus {
  return STATUS_SET.has(value);
}

export interface Campaign {
  id: string;
  name: string;
  platform: string;
  status: CampaignStatus;
  project_id: string | null;
  external_id: string | null;
  start_date: string | null;
  end_date: string | null;
  budget_inr: number;
  spent_inr: number;
  impressions: number;
  clicks: number;
  created_at: string;
  updated_at: string;
}

/** One row of villa_campaign_performance, plus the CTR the view does not compute. */
export interface CampaignPerformance {
  id: string;
  name: string;
  platform: string;
  status: CampaignStatus;
  budget_inr: number;
  spent_inr: number;
  impressions: number;
  clicks: number;
  leads: number;
  qualified_leads: number;
  bookings: number;
  revenue_inr: number;
  /** Null when the campaign has produced no leads — cost per nothing is undefined. */
  cpl_inr: number | null;
  /** Null when nothing has been spent yet. */
  roas: number | null;
  /** Null when nothing was ever served. */
  ctr: number | null;
}

export interface MarketingSummary {
  campaigns: number;
  totalSpendInr: number;
  /** Leads whose `campaign` matches a campaign name — not every lead in the system. */
  totalLeads: number;
  blendedCplInr: number | null;
  totalRevenueInr: number;
  blendedRoas: number | null;
}

export type WriteResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * A zero denominator means "not knowable yet", never 0. Returning null here is
 * what keeps NaN and Infinity out of every rate shown on the marketing pages.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * PostgREST serialises wide bigint/numeric aggregates as JSON strings, and a
 * string reaching arithmetic downstream shows up as NaN in the UI instead of
 * failing loudly. Coerce once, at the read boundary.
 */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeInt(value: number, label: string): number | string {
  if (!Number.isFinite(value) || value < 0) return `${label} must be zero or a positive number`;
  return Math.round(value);
}

// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------

export async function listCampaigns(): Promise<Campaign[]> {
  const { data } = await db()
    .from("villa_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Campaign[];
}

export async function campaignPerformance(): Promise<CampaignPerformance[]> {
  const { data } = await db()
    .from("villa_campaign_performance")
    .select("*")
    .order("spent_inr", { ascending: false });

  return (data ?? []).map((row: Record<string, unknown>) => {
    const impressions = num(row.impressions);
    const clicks = num(row.clicks);
    return {
      id: String(row.id),
      name: String(row.name),
      platform: String(row.platform),
      status: String(row.status) as CampaignStatus,
      budget_inr: num(row.budget_inr),
      spent_inr: num(row.spent_inr),
      impressions,
      clicks,
      leads: num(row.leads),
      qualified_leads: num(row.qualified_leads),
      bookings: num(row.bookings),
      revenue_inr: num(row.revenue_inr),
      cpl_inr: numOrNull(row.cpl_inr),
      roas: numOrNull(row.roas),
      ctr: safeRatio(clicks, impressions),
    };
  });
}

export interface NewCampaign {
  name: string;
  platform: string;
  status?: CampaignStatus;
  budgetInr?: number;
  startDate?: string | null;
  endDate?: string | null;
}

export async function createCampaign(input: NewCampaign): Promise<WriteResult> {
  const name = input.name.trim();
  const platform = input.platform.trim();
  if (!name) return { ok: false, error: "Campaign name is required" };
  if (!platform) return { ok: false, error: "Platform is required" };

  const budget = nonNegativeInt(input.budgetInr ?? 0, "Budget");
  if (typeof budget === "string") return { ok: false, error: budget };

  const { data, error } = await db()
    .from("villa_campaigns")
    .insert({
      name,
      platform,
      status: input.status ?? "draft",
      budget_inr: budget,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
    })
    .select("id")
    .single();

  if (error) {
    // The table is unique on (platform, name); say that plainly rather than
    // leaking a Postgres constraint name to whoever filled in the form.
    if (error.code === "23505") {
      return { ok: false, error: `A campaign named "${name}" already exists on ${platform}` };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id as string | undefined };
}

export interface SpendPatch {
  spentInr?: number;
  impressions?: number;
  clicks?: number;
}

/**
 * Only the fields actually supplied are written, so the form can leave
 * impressions or clicks blank to mean "unchanged" instead of zeroing a figure
 * that was already correct.
 */
export async function updateCampaignSpend(id: string, patch: SpendPatch): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Campaign is required" };

  const update: Record<string, number> = {};
  const fields: Array<[keyof SpendPatch, string, string]> = [
    ["spentInr", "spent_inr", "Spend"],
    ["impressions", "impressions", "Impressions"],
    ["clicks", "clicks", "Clicks"],
  ];

  for (const [key, column, label] of fields) {
    const value = patch[key];
    if (value === undefined) continue;
    const checked = nonNegativeInt(value, label);
    if (typeof checked === "string") return { ok: false, error: checked };
    update[column] = checked;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "Enter at least one of spend, impressions or clicks" };
  }

  const { error } = await db().from("villa_campaigns").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Blended marketing economics.
 *
 * Leads are summed from villa_campaign_performance, which joins leads on
 * campaign name — so this counts campaign-attributed leads only. Organic,
 * referral and walk-in leads are deliberately excluded: dividing ad spend by
 * leads it did not buy would flatter the CPL.
 */
export async function marketingSummary(): Promise<MarketingSummary> {
  const rows = await campaignPerformance();

  const totalSpendInr = rows.reduce((sum, r) => sum + r.spent_inr, 0);
  const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0);
  const totalRevenueInr = rows.reduce((sum, r) => sum + r.revenue_inr, 0);

  return {
    campaigns: rows.length,
    totalSpendInr,
    totalLeads,
    blendedCplInr: safeRatio(totalSpendInr, totalLeads),
    totalRevenueInr,
    blendedRoas: safeRatio(totalRevenueInr, totalSpendInr),
  };
}

// -----------------------------------------------------------------------------
// Touchpoints — multi-touch attribution
// -----------------------------------------------------------------------------

export interface Touchpoint {
  id: string;
  lead_id: string;
  channel: string;
  campaign: string | null;
  detail: string | null;
  occurred_at: string;
}

/** One lead's path across channels, collapsed to what attribution actually asks. */
export interface LeadJourney {
  leadId: string;
  name: string | null;
  phone: string | null;
  firstChannel: string;
  firstAt: string;
  lastChannel: string;
  lastAt: string;
  touches: number;
  /** Distinct channels in the order they were first seen. */
  path: string[];
}

export interface ChannelBreakdown {
  channel: string;
  touches: number;
  leads: number;
  firstTouches: number;
  lastTouches: number;
  /** Share of all recorded touches. Null only when nothing has been recorded. */
  share: number | null;
}

export interface MultiTouch {
  journeys: LeadJourney[];
  channels: ChannelBreakdown[];
  totalTouches: number;
}

/**
 * Records one interaction on a lead's path. villa_leads already stores the
 * first-touch source; this is what makes last-touch and everything between
 * knowable, so it should be called wherever a lead surfaces on a channel.
 */
export async function recordTouchpoint(
  leadId: string,
  channel: string,
  campaign?: string | null,
  detail?: string | null,
): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "leadId is required" };
  const trimmed = channel.trim();
  if (!trimmed) return { ok: false, error: "channel is required" };

  const { error } = await db().from("villa_touchpoints").insert({
    lead_id: leadId,
    channel: trimmed,
    campaign: campaign || null,
    detail: detail || null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

type TouchpointRow = Touchpoint & {
  villa_leads: { name: string | null; phone: string } | null;
};

/**
 * Groups every recorded touch into per-lead journeys and a channel breakdown
 * in one pass, so the attribution page costs a single query.
 */
export async function multiTouchAttribution(limit = 2000): Promise<MultiTouch> {
  const { data } = await db()
    .from("villa_touchpoints")
    .select("id, lead_id, channel, campaign, detail, occurred_at, villa_leads(name, phone)")
    .order("occurred_at", { ascending: true })
    .limit(limit);

  const rows = (data ?? []) as unknown as TouchpointRow[];

  const byLead = new Map<string, { row: TouchpointRow; touches: TouchpointRow[] }>();
  for (const row of rows) {
    const existing = byLead.get(row.lead_id);
    if (existing) existing.touches.push(row);
    else byLead.set(row.lead_id, { row, touches: [row] });
  }

  const journeys: LeadJourney[] = [];
  for (const [leadId, { row, touches }] of byLead) {
    const first = touches[0];
    const last = touches[touches.length - 1];
    const path: string[] = [];
    for (const t of touches) if (!path.includes(t.channel)) path.push(t.channel);

    journeys.push({
      leadId,
      name: row.villa_leads?.name ?? null,
      phone: row.villa_leads?.phone ?? null,
      firstChannel: first.channel,
      firstAt: first.occurred_at,
      lastChannel: last.channel,
      lastAt: last.occurred_at,
      touches: touches.length,
      path,
    });
  }

  journeys.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  const stats = new Map<string, { touches: number; leads: Set<string>; first: number; last: number }>();
  const bump = (channel: string) => {
    let s = stats.get(channel);
    if (!s) {
      s = { touches: 0, leads: new Set(), first: 0, last: 0 };
      stats.set(channel, s);
    }
    return s;
  };

  for (const row of rows) {
    const s = bump(row.channel);
    s.touches += 1;
    s.leads.add(row.lead_id);
  }
  for (const j of journeys) {
    bump(j.firstChannel).first += 1;
    bump(j.lastChannel).last += 1;
  }

  const channels: ChannelBreakdown[] = [...stats.entries()]
    .map(([channel, s]) => ({
      channel,
      touches: s.touches,
      leads: s.leads.size,
      firstTouches: s.first,
      lastTouches: s.last,
      share: safeRatio(s.touches, rows.length),
    }))
    .sort((a, b) => b.touches - a.touches);

  return { journeys, channels, totalTouches: rows.length };
}
