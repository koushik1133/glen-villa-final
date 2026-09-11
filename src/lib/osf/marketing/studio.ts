import { campaignPerformance, safeRatio, type CampaignPerformance, type WriteResult } from "../campaigns";
import { projectsWithTypes } from "../queries";
import { db } from "../supabase";
import type { Project, VillaType } from "../types";
import { EDITABLE_STATUSES, type ContentFormat, type ContentStatus, type ContentTone } from "./formats";

/**
 * Server-side data layer for the marketing module: the content studio, the
 * publish queue, and the analytics behind /marketing/overview and
 * /marketing/whatsapp.
 *
 * The recurring constraint here is that no ad platform and no Meta Graph
 * integration exists. Every figure below is therefore counted from rows this
 * system wrote itself — impressions and spend because a human typed them in,
 * messages because the webhook stored them. Nothing derives a reach, a delivery
 * rate or an open rate, because there is no source for one. Where a page would
 * naturally want such a number, it says why it is absent instead.
 */

// -----------------------------------------------------------------------------
// Content drafts
// -----------------------------------------------------------------------------

export interface StudioScene {
  sceneNumber: number;
  timeRange: string;
  visualPrompt: string;
  voiceoverOrText: string;
  soundEffectOrAudio: string;
}

export interface StudioDraft {
  id: string;
  project_id: string | null;
  villa_type_id: string | null;
  format: ContentFormat;
  tone: ContentTone;
  language: string;
  headline: string;
  primary_text: string;
  secondary_text: string | null;
  hashtags: string[];
  call_to_action: string | null;
  cta_button_text: string | null;
  suggested_audio: string | null;
  video_script: StudioScene[] | null;
  visual_prompt: string | null;
  target_audience_advice: string | null;
  target_platforms: string[];
  generated_by_ai: boolean;
  status: ContentStatus;
  created_at: string;
}

const DRAFT_COLUMNS =
  "id, project_id, villa_type_id, format, tone, language, headline, primary_text, secondary_text, " +
  "hashtags, call_to_action, cta_button_text, suggested_audio, video_script, visual_prompt, " +
  "target_audience_advice, target_platforms, generated_by_ai, status, created_at";

export async function listDrafts(limit = 40, format?: ContentFormat): Promise<StudioDraft[]> {
  let query = db().from("villa_content_drafts").select(DRAFT_COLUMNS);
  if (format) query = query.eq("format", format);

  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as StudioDraft[];
}

// -----------------------------------------------------------------------------
// Publishing — a queue, not an integration
// -----------------------------------------------------------------------------

/**
 * What a villa_publish_log row can say.
 *
 * 'pending_manual' is the only status this app can write on its own: it records
 * that somebody asked for a post, nothing more. 'posted_manually' is set when a
 * human comes back and confirms they published it, optionally with the live
 * URL. There is no 'published' — that word would imply this system did it.
 */
export type PublishStatus = "pending_manual" | "posted_manually" | "cancelled";

export interface PublishChannel {
  channel: string;
  label: string;
  enabled: boolean;
  credential_status: string;
  notes: string | null;
}

export interface PublishEntry {
  id: string;
  draft_id: string;
  channel: string;
  status: PublishStatus;
  external_url: string | null;
  published_at: string | null;
  created_at: string;
}

export async function publishChannels(): Promise<PublishChannel[]> {
  const { data } = await db()
    .from("villa_channel_settings")
    .select("channel, label, enabled, credential_status, notes")
    .order("label", { ascending: true });
  return (data ?? []) as PublishChannel[];
}

export async function publishLog(limit = 200): Promise<PublishEntry[]> {
  const { data } = await db()
    .from("villa_publish_log")
    .select("id, draft_id, channel, status, external_url, published_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PublishEntry[];
}

/**
 * Records the intent to post a draft on one or more channels.
 *
 * Calls no platform API — none is connected, and no credential for one exists.
 * Every row lands as 'pending_manual' so the queue reads as a to-do list for a
 * human rather than as evidence anything went live.
 */
export type QueueResult = { ok: true; entries: PublishEntry[] } | { ok: false; error: string };

export async function queuePublish(draftId: string, channels: string[]): Promise<QueueResult> {
  if (!draftId) return { ok: false, error: "Pick a draft first" };

  const wanted = [...new Set(channels.map((c) => c.trim()).filter(Boolean))];
  if (wanted.length === 0) return { ok: false, error: "Pick at least one channel" };

  const supabase = db();

  const [{ data: draft }, { data: settings }, { data: existing }] = await Promise.all([
    supabase.from("villa_content_drafts").select("id, status").eq("id", draftId).maybeSingle(),
    supabase.from("villa_channel_settings").select("channel, enabled"),
    supabase
      .from("villa_publish_log")
      .select("channel")
      .eq("draft_id", draftId)
      .eq("status", "pending_manual"),
  ]);

  if (!draft) return { ok: false, error: "That draft no longer exists" };

  // Re-checked server-side: the checkboxes are rendered from the same table,
  // but a disabled channel must not become postable by editing the form.
  const enabled = new Set(
    ((settings ?? []) as { channel: string; enabled: boolean }[])
      .filter((s) => s.enabled)
      .map((s) => s.channel),
  );
  const rejected = wanted.filter((c) => !enabled.has(c));
  if (rejected.length > 0) {
    return { ok: false, error: `Not enabled for publishing: ${rejected.join(", ")}` };
  }

  const alreadyQueued = new Set(((existing ?? []) as { channel: string }[]).map((r) => r.channel));
  const fresh = wanted.filter((c) => !alreadyQueued.has(c));
  if (fresh.length === 0) {
    return { ok: false, error: "Already queued on every channel you picked" };
  }

  const { data: inserted, error } = await supabase
    .from("villa_publish_log")
    .insert(fresh.map((channel) => ({ draft_id: draftId, channel, status: "pending_manual" })))
    .select("id, draft_id, channel, status, external_url, published_at, created_at");
  if (error) return { ok: false, error: error.message };

  // A queued draft is committed to, so it should stop reading as a rough draft.
  // 'scheduled' is the closest honest word the enum has: somebody intends to
  // post it, and nobody has yet.
  if (draft.status === "draft" || draft.status === "ready") {
    await supabase.from("villa_content_drafts").update({ status: "scheduled" }).eq("id", draftId);
  }

  return { ok: true, entries: (inserted ?? []) as PublishEntry[] };
}

/** Same-origin-agnostic, but still has to be a real web link before it is stored. */
function normaliseExternalUrl(value: string | undefined): string | null | { error: string } {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "The post URL must start with http:// or https://" };
    }
    return url.href;
  } catch {
    return { error: "That post URL isn't a valid link" };
  }
}

/**
 * A human confirming they posted it themselves.
 *
 * This is the only path by which a draft reaches 'published', and it requires
 * somebody to assert it — the app never infers it.
 */
export async function markPosted(entryId: string, externalUrl?: string): Promise<WriteResult> {
  if (!entryId) return { ok: false, error: "Pick a queued post first" };

  const url = normaliseExternalUrl(externalUrl);
  if (url !== null && typeof url === "object") return { ok: false, error: url.error };

  const supabase = db();
  const { data: entry } = await supabase
    .from("villa_publish_log")
    .select("id, draft_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "That queue entry no longer exists" };

  const { error } = await supabase
    .from("villa_publish_log")
    .update({
      status: "posted_manually",
      external_url: url,
      published_at: new Date().toISOString(),
    })
    .eq("id", entryId);
  if (error) return { ok: false, error: error.message };

  const draftId = (entry as { draft_id: string | null }).draft_id;
  if (draftId) {
    const { count } = await supabase
      .from("villa_publish_log")
      .select("id", { count: "exact", head: true })
      .eq("draft_id", draftId)
      .eq("status", "pending_manual");

    // Only once nothing is still waiting — a draft posted to Instagram but not
    // yet to Facebook is not published.
    if ((count ?? 0) === 0) {
      await supabase.from("villa_content_drafts").update({ status: "published" }).eq("id", draftId);
    }
  }

  return { ok: true, id: entryId };
}

/**
 * Hand-editing of a draft's status.
 *
 * Restricted to EDITABLE_STATUSES: 'scheduled' is owned by `queuePublish` and
 * 'published' by `markPosted`, so letting a <select> write either would let the
 * library contradict the publish log sitting next to it.
 */
export async function setDraftStatus(draftId: string, status: string): Promise<WriteResult> {
  if (!draftId) return { ok: false, error: "Pick a draft first" };
  if (!(EDITABLE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Status "${status}" is set by the publish queue, not by hand` };
  }

  const { error } = await db()
    .from("villa_content_drafts")
    .update({ status })
    .eq("id", draftId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: draftId };
}

export async function cancelQueued(entryId: string): Promise<WriteResult> {
  if (!entryId) return { ok: false, error: "Pick a queued post first" };
  const { error } = await db()
    .from("villa_publish_log")
    .update({ status: "cancelled" })
    .eq("id", entryId)
    .eq("status", "pending_manual");
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: entryId };
}

// -----------------------------------------------------------------------------
// Studio page load
// -----------------------------------------------------------------------------

export interface StudioData {
  projects: Project[];
  villaTypes: VillaType[];
  drafts: StudioDraft[];
  channels: PublishChannel[];
  queue: PublishEntry[];
  /**
   * Headline for every draft the queue references, including ones older than
   * the library window. Without it a queue row for the 40th-newest draft would
   * render as "Draft removed", which is a different and false claim.
   */
  queueHeadlines: Map<string, string>;
}

/**
 * Everything /marketing/studio renders, in one parallel round-trip.
 *
 * The queue is fetched whole rather than per-draft: the library shows a
 * "queued on N channels" state for every card, and issuing one query per card
 * would turn a 30-draft page into 31 round-trips.
 */
export async function studioData(): Promise<StudioData> {
  const [{ projects, villaTypes }, drafts, channels, queue] = await Promise.all([
    projectsWithTypes(),
    listDrafts(30),
    publishChannels(),
    publishLog(120),
  ]);

  const queueHeadlines = new Map(drafts.map((d) => [d.id, d.headline]));
  const unknown = [...new Set(queue.map((q) => q.draft_id))].filter(
    (id) => id && !queueHeadlines.has(id),
  );

  // Second round-trip only when the queue actually reaches past the library
  // window, which is the uncommon case.
  if (unknown.length > 0) {
    const { data } = await db()
      .from("villa_content_drafts")
      .select("id, headline")
      .in("id", unknown);
    for (const row of (data ?? []) as { id: string; headline: string }[]) {
      queueHeadlines.set(row.id, row.headline);
    }
  }

  return { projects, villaTypes, drafts, channels, queue, queueHeadlines };
}

/** Queue entries grouped by the draft they belong to, newest first within each. */
export function queueByDraft(queue: PublishEntry[]): Map<string, PublishEntry[]> {
  const byDraft = new Map<string, PublishEntry[]>();
  for (const entry of queue) {
    const list = byDraft.get(entry.draft_id);
    if (list) list.push(entry);
    else byDraft.set(entry.draft_id, [entry]);
  }
  return byDraft;
}

// -----------------------------------------------------------------------------
// Time bucketing
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Beyond this a daily axis is unreadable, so buckets widen instead of multiplying. */
const MAX_BUCKETS = 60;

export interface Series {
  points: { label: string; [key: string]: string | number }[];
  /** "daily", "weekly" or "12-day" — printed next to the chart so the axis isn't a mystery. */
  granularity: string;
  /** True when the row cap was hit and the earliest rows are missing. */
  truncated: boolean;
}

interface Buckets {
  starts: number[];
  step: number;
  granularity: string;
}

function planBuckets(days: number | null, earliestMs: number | null): Buckets {
  const now = Date.now();
  const rawStart = days !== null ? now - (days - 1) * DAY_MS : (earliestMs ?? now);

  const start = new Date(rawStart);
  start.setHours(0, 0, 0, 0);

  const spanDays = Math.max(1, Math.round((now - start.getTime()) / DAY_MS) + 1);
  const stepDays = Math.max(1, Math.ceil(spanDays / MAX_BUCKETS));
  const step = stepDays * DAY_MS;

  const starts: number[] = [];
  for (let t = start.getTime(); t <= now; t += step) starts.push(t);
  if (starts.length === 0) starts.push(start.getTime());

  const granularity = stepDays === 1 ? "daily" : stepDays === 7 ? "weekly" : `${stepDays}-day`;
  return { starts, step, granularity };
}

function bucketLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function bucketIndex(buckets: Buckets, iso: string): number | null {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const i = Math.floor((ms - buckets.starts[0]) / buckets.step);
  if (i < 0) return null;
  return Math.min(i, buckets.starts.length - 1);
}

/**
 * Rolls timestamped rows into a fixed set of buckets.
 *
 * Buckets with no rows stay in the output at zero rather than being dropped: a
 * day with no leads is a fact about the day, and collapsing it would make a
 * quiet week look like a busy one.
 */
function toSeries<T>(
  rows: T[],
  at: (row: T) => string,
  keys: { key: string; matches: (row: T) => boolean }[],
  days: number | null,
  truncated: boolean,
): Series {
  const earliest = rows.length > 0 ? Math.min(...rows.map((r) => new Date(at(r)).getTime())) : null;
  const buckets = planBuckets(days, Number.isFinite(earliest ?? NaN) ? earliest : null);

  const points = buckets.starts.map((ms) => {
    const point: { label: string; [key: string]: string | number } = { label: bucketLabel(ms) };
    for (const k of keys) point[k.key] = 0;
    return point;
  });

  for (const row of rows) {
    const i = bucketIndex(buckets, at(row));
    if (i === null) continue;
    for (const k of keys) {
      if (k.matches(row)) (points[i][k.key] as number) += 1;
    }
  }

  return { points, granularity: buckets.granularity, truncated };
}

// -----------------------------------------------------------------------------
// Marketing overview
// -----------------------------------------------------------------------------

export interface OverviewMetrics {
  campaigns: number;
  activeCampaigns: number;
  totalSpendInr: number;
  totalBudgetInr: number;
  totalImpressions: number;
  totalClicks: number;
  totalLeads: number;
  totalQualified: number;
  totalBookings: number;
  totalRevenueInr: number;
  /** All null-able: a rate with a zero denominator is unknown, not zero. */
  blendedCtr: number | null;
  blendedCplInr: number | null;
  qualifiedCplInr: number | null;
  blendedRoas: number | null;
  qualifyRate: number | null;
  bookingRate: number | null;
}

export function overviewMetrics(rows: CampaignPerformance[]): OverviewMetrics {
  const sum = (pick: (r: CampaignPerformance) => number) => rows.reduce((t, r) => t + pick(r), 0);

  const totalSpendInr = sum((r) => r.spent_inr);
  const totalImpressions = sum((r) => r.impressions);
  const totalClicks = sum((r) => r.clicks);
  const totalLeads = sum((r) => r.leads);
  const totalQualified = sum((r) => r.qualified_leads);
  const totalBookings = sum((r) => r.bookings);
  const totalRevenueInr = sum((r) => r.revenue_inr);

  return {
    campaigns: rows.length,
    activeCampaigns: rows.filter((r) => r.status === "active").length,
    totalSpendInr,
    totalBudgetInr: sum((r) => r.budget_inr),
    totalImpressions,
    totalClicks,
    totalLeads,
    totalQualified,
    totalBookings,
    totalRevenueInr,
    blendedCtr: safeRatio(totalClicks, totalImpressions),
    blendedCplInr: safeRatio(totalSpendInr, totalLeads),
    qualifiedCplInr: safeRatio(totalSpendInr, totalQualified),
    blendedRoas: safeRatio(totalRevenueInr, totalSpendInr),
    qualifyRate: safeRatio(totalQualified, totalLeads),
    bookingRate: safeRatio(totalBookings, totalLeads),
  };
}

export interface PlatformSplit {
  platform: string;
  spendInr: number;
  leads: number;
  qualified: number;
  revenueInr: number;
  cplInr: number | null;
  roas: number | null;
  /** Percentage points, so spend share and lead share share one axis. */
  spendSharePct: number | null;
  leadSharePct: number | null;
}

export function platformSplit(rows: CampaignPerformance[]): PlatformSplit[] {
  const totals = new Map<string, { spendInr: number; leads: number; qualified: number; revenueInr: number }>();

  for (const row of rows) {
    const bucket = totals.get(row.platform) ?? { spendInr: 0, leads: 0, qualified: 0, revenueInr: 0 };
    bucket.spendInr += row.spent_inr;
    bucket.leads += row.leads;
    bucket.qualified += row.qualified_leads;
    bucket.revenueInr += row.revenue_inr;
    totals.set(row.platform, bucket);
  }

  const allSpend = [...totals.values()].reduce((t, b) => t + b.spendInr, 0);
  const allLeads = [...totals.values()].reduce((t, b) => t + b.leads, 0);

  return [...totals.entries()]
    .map(([platform, b]) => ({
      platform,
      spendInr: b.spendInr,
      leads: b.leads,
      qualified: b.qualified,
      revenueInr: b.revenueInr,
      cplInr: safeRatio(b.spendInr, b.leads),
      roas: safeRatio(b.revenueInr, b.spendInr),
      spendSharePct: mulPct(safeRatio(b.spendInr, allSpend)),
      leadSharePct: mulPct(safeRatio(b.leads, allLeads)),
    }))
    .sort((a, b) => b.spendInr - a.spendInr);
}

function mulPct(ratio: number | null): number | null {
  return ratio === null ? null : Number((ratio * 100).toFixed(1));
}

const LEAD_FLOW_CAP = 4000;

/**
 * Campaign-attributed leads over time.
 *
 * Only leads carrying a campaign name, because this chart sits under ad spend —
 * counting walk-ins and referrals here would credit the ads with traffic they
 * did not buy.
 */
export async function campaignLeadFlow(sinceIso: string | null, days: number | null): Promise<Series> {
  let query = db()
    .from("villa_leads")
    .select("created_at, lead_score")
    .not("campaign", "is", null);
  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { data } = await query.order("created_at", { ascending: false }).limit(LEAD_FLOW_CAP);
  const rows = (data ?? []) as { created_at: string; lead_score: number }[];

  return toSeries(
    rows,
    (r) => r.created_at,
    [
      { key: "leads", matches: () => true },
      // 50 is the qualified threshold villa_campaign_performance uses; the two
      // must agree or the chart contradicts the table above it.
      { key: "qualified", matches: (r) => r.lead_score >= 50 },
    ],
    days,
    rows.length === LEAD_FLOW_CAP,
  );
}

export async function marketingOverview(sinceIso: string | null, days: number | null) {
  const [rows, leadFlow] = await Promise.all([campaignPerformance(), campaignLeadFlow(sinceIso, days)]);
  return {
    rows,
    metrics: overviewMetrics(rows),
    platforms: platformSplit(rows),
    leadFlow,
  };
}

// -----------------------------------------------------------------------------
// WhatsApp channel
// -----------------------------------------------------------------------------

/** Roles the agent writes; everything else on the channel came from the buyer. */
const OUTBOUND_ROLES = ["agent", "human_agent"];

export interface WhatsappMetrics {
  aiSent: number;
  humanSent: number;
  sent: number;
  received: number;
  mediaMessages: number;
  conversations: number;
  openConversations: number;
  leads: number;
  qualifiedLeads: number;
  optedOut: number;
  aiPaused: number;
  handoffs: number;
  brochureSent: number;
  floorPlanSent: number;
  priceSheetSent: number;
  videoSent: number;
}

/** Supabase builders are lazy thenables, so these all fire together under Promise.all. */
async function countOf(query: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await query;
  return count ?? 0;
}

const MESSAGE_TREND_CAP = 5000;

export async function whatsappMetrics(sinceIso: string | null): Promise<WhatsappMetrics> {
  const supabase = db();

  const messages = () => {
    const q = supabase.from("villa_messages").select("id", { count: "exact", head: true }).eq("channel", "whatsapp");
    return sinceIso ? q.gte("created_at", sinceIso) : q;
  };
  const leads = () => {
    const q = supabase.from("villa_leads").select("id", { count: "exact", head: true }).eq("source", "whatsapp");
    return sinceIso ? q.gte("created_at", sinceIso) : q;
  };

  const [
    aiSent,
    humanSent,
    received,
    mediaMessages,
    conversations,
    openConversations,
    leadCount,
    qualifiedLeads,
    optedOut,
    aiPaused,
    handoffs,
    brochureSent,
    floorPlanSent,
    priceSheetSent,
    videoSent,
  ] = await Promise.all([
    countOf(messages().eq("role", "agent")),
    countOf(messages().eq("role", "human_agent")),
    countOf(messages().eq("role", "customer")),
    countOf(messages().not("media_url", "is", null)),
    countOf(
      (() => {
        const q = supabase
          .from("villa_conversations")
          .select("id", { count: "exact", head: true })
          .eq("channel", "whatsapp");
        return sinceIso ? q.gte("started_at", sinceIso) : q;
      })(),
    ),
    countOf(
      (() => {
        const q = supabase
          .from("villa_conversations")
          .select("id", { count: "exact", head: true })
          .eq("channel", "whatsapp")
          .eq("status", "open");
        return sinceIso ? q.gte("started_at", sinceIso) : q;
      })(),
    ),
    countOf(leads()),
    countOf(leads().gte("lead_score", 50)),
    countOf(leads().eq("opted_out", true)),
    countOf(leads().eq("ai_paused", true)),
    countOf(
      (() => {
        const q = supabase.from("villa_handoffs").select("id", { count: "exact", head: true });
        return sinceIso ? q.gte("created_at", sinceIso) : q;
      })(),
    ),
    countOf(leads().eq("brochure_sent", true)),
    countOf(leads().eq("floor_plan_sent", true)),
    countOf(leads().eq("price_sheet_sent", true)),
    countOf(leads().eq("video_sent", true)),
  ]);

  return {
    aiSent,
    humanSent,
    sent: aiSent + humanSent,
    received,
    mediaMessages,
    conversations,
    openConversations,
    leads: leadCount,
    qualifiedLeads,
    optedOut,
    aiPaused,
    handoffs,
    brochureSent,
    floorPlanSent,
    priceSheetSent,
    videoSent,
  };
}

export async function whatsappMessageFlow(sinceIso: string | null, days: number | null): Promise<Series> {
  let query = db()
    .from("villa_messages")
    .select("created_at, role")
    .eq("channel", "whatsapp");
  if (sinceIso) query = query.gte("created_at", sinceIso);

  // Newest-first then reversed: hitting the cap should cost the oldest rows,
  // not the ones nearest the right-hand edge of the chart.
  const { data } = await query.order("created_at", { ascending: false }).limit(MESSAGE_TREND_CAP);
  const rows = ((data ?? []) as { created_at: string; role: string }[]).slice().reverse();

  return toSeries(
    rows,
    (r) => r.created_at,
    [
      { key: "received", matches: (r) => r.role === "customer" },
      { key: "sent", matches: (r) => OUTBOUND_ROLES.includes(r.role) },
    ],
    days,
    rows.length === MESSAGE_TREND_CAP,
  );
}

export interface WhatsappChannelData {
  metrics: WhatsappMetrics;
  flow: Series;
  broadcasts: StudioDraft[];
}

export async function whatsappChannel(
  sinceIso: string | null,
  days: number | null,
): Promise<WhatsappChannelData> {
  const [metrics, flow, broadcasts] = await Promise.all([
    whatsappMetrics(sinceIso),
    whatsappMessageFlow(sinceIso, days),
    listDrafts(8, "whatsapp"),
  ]);
  return { metrics, flow, broadcasts };
}
