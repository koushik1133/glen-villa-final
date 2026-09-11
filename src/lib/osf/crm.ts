import type { BadgeTone } from "@/components/osf/ui";
import { logActivity } from "./activities";
import { db } from "./supabase";

/**
 * Reads and writes for the CRM section (leads, pipeline, contacts, customers,
 * tasks, follow-ups).
 *
 * The enum mirrors below are transcribed from supabase/migrations/001_schema.sql
 * rather than imported from src/lib/types.ts: that file predates the schema
 * rewrite and its PipelineStage union is missing three values the database
 * accepts (`contacted`, `site_visit_completed`, `token_paid`). A board built on
 * the narrow union would silently drop every lead sitting in one of them.
 */

// -----------------------------------------------------------------------------
// Enum mirrors
// -----------------------------------------------------------------------------

/** Filter order, which is also the left-to-right order of the Kanban board. */
export const PIPELINE_STAGES = [
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "site_visit_scheduled",
  "site_visit_completed",
  "negotiation",
  "token_paid",
  "booked",
  "lost",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  qualified: "Qualified",
  site_visit_scheduled: "Visit scheduled",
  site_visit_completed: "Visit completed",
  negotiation: "Negotiation",
  token_paid: "Token paid",
  booked: "Booked",
  lost: "Lost",
};

export const STAGE_TONES: Record<PipelineStage, BadgeTone> = {
  new: "neutral",
  contacted: "neutral",
  qualifying: "info",
  qualified: "info",
  site_visit_scheduled: "warning",
  site_visit_completed: "warning",
  negotiation: "gold",
  token_paid: "gold",
  booked: "success",
  lost: "danger",
};

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
};

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_TONES: Record<TaskPriority, BadgeTone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export const FOLLOWUP_STATUSES = ["pending", "completed", "missed", "rescheduled"] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_STATUS_TONES: Record<FollowUpStatus, BadgeTone> = {
  pending: "info",
  completed: "success",
  missed: "danger",
  rescheduled: "warning",
};

export const COMM_CHANNELS = [
  "whatsapp",
  "instagram",
  "facebook",
  "email",
  "sms",
  "web_form",
  "call",
] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  initiated: "Initiated",
  agreement_sent: "Agreement sent",
  signed: "Signed",
  token_paid: "Token paid",
  registered: "Registered",
  cancelled: "Cancelled",
};

const STAGE_SET = new Set<string>(PIPELINE_STAGES);
const TEMP_SET = new Set<string>(TEMPERATURES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITIES);
const CHANNEL_SET = new Set<string>(COMM_CHANNELS);

export function isPipelineStage(value: string | undefined): value is PipelineStage {
  return value !== undefined && STAGE_SET.has(value);
}
export function isTemperature(value: string | undefined): value is Temperature {
  return value !== undefined && TEMP_SET.has(value);
}
export function isTaskPriority(value: string | undefined): value is TaskPriority {
  return value !== undefined && PRIORITY_SET.has(value);
}
export function isCommChannel(value: string | undefined): value is CommChannel {
  return value !== undefined && CHANNEL_SET.has(value);
}

/** Sentinel the rep filter uses for "nobody owns this lead". */
export const UNASSIGNED = "unassigned";

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------

export interface TeamRef {
  id: string;
  name: string;
  role: string;
}

export interface LeadRef {
  id: string;
  name: string | null;
  phone: string;
}

export interface CrmLeadRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  is_nri: boolean;
  lead_temperature: Temperature;
  lead_score: number;
  pipeline_stage: PipelineStage;
  budget_min_inr: number | null;
  budget_max_inr: number | null;
  purchase_timeline: string;
  source: string;
  campaign: string | null;
  assigned_to: string | null;
  ai_paused: boolean;
  opted_out: boolean;
  is_future_prospect: boolean;
  reconnect_at: string | null;
  last_contact_at: string;
  created_at: string;
  assignee: TeamRef | null;
}

const LEAD_ROW_SELECT = `
  id, name, phone, email, city, is_nri, lead_temperature, lead_score, pipeline_stage,
  budget_min_inr, budget_max_inr, purchase_timeline, source, campaign, assigned_to,
  ai_paused, opted_out, is_future_prospect, reconnect_at, last_contact_at, created_at,
  assignee:villa_team_members(id, name, role)
`;

export interface CrmLead extends CrmLeadRow {
  country: string | null;
  preferred_language: string;
  bedrooms: number | null;
  buyer_purpose: string | null;
  financing_preference: string | null;
  preferred_location: string | null;
  facing_preference: string | null;
  amenities_of_interest: string[] | null;
  requirements_notes: string | null;
  sentiment: string | null;
  ai_summary: string | null;
  brochure_sent: boolean;
  floor_plan_sent: boolean;
  price_sheet_sent: boolean;
  video_sent: boolean;
  handoff_status: string;
  handoff_reason: string | null;
  handoff_at: string | null;
  consent_status: string;
  notes: string | null;
  first_contact_at: string;
  project: { id: string; name: string } | null;
  villa_type: { id: string; name: string; price_inr: number | null } | null;
}

export interface CrmMessage {
  id: string;
  role: "customer" | "agent" | "human_agent" | "system";
  channel: string;
  body: string | null;
  media_url: string | null;
  media_kind: string | null;
  created_at: string;
}

export interface CrmActivity {
  id: string;
  actor: string | null;
  activity_type: string;
  description: string;
  channel: string | null;
  created_at: string;
}

export interface CrmTask {
  id: string;
  title: string;
  description: string | null;
  lead_id: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  lead: LeadRef | null;
  assignee: TeamRef | null;
}

export interface CrmFollowUp {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  scheduled_at: string;
  completed_at: string | null;
  status: FollowUpStatus;
  channel: string;
  message: string | null;
  template_name: string | null;
  notes: string | null;
  ai_generated: boolean;
  dispatched_at: string | null;
  created_at: string;
  lead: LeadRef | null;
  assignee: TeamRef | null;
}

export interface CrmSiteVisit {
  id: string;
  scheduled_at: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  completed_at: string | null;
  visitor_count: number | null;
  visit_type: string;
  status: string;
  outcome: string | null;
  feedback: string | null;
  notes: string | null;
  created_at: string;
  project: { name: string } | null;
  assignee: TeamRef | null;
}

export interface CrmTouchpoint {
  id: string;
  channel: string;
  campaign: string | null;
  detail: string | null;
  occurred_at: string;
}

const TASK_SELECT =
  "id, title, description, lead_id, assigned_to, status, priority, task_type, due_at, completed_at, created_at, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name, role)";

const FOLLOW_UP_SELECT =
  "id, lead_id, assigned_to, scheduled_at, completed_at, status, channel, message, template_name, notes, ai_generated, dispatched_at, created_at, lead:villa_leads(id, name, phone), assignee:villa_team_members(id, name, role)";

/**
 * PostgREST returns an embedded one-to-one as an object, but supabase-js types
 * every embed as an array. Casting through `unknown` once here keeps that lie
 * out of every call site.
 */
function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

// -----------------------------------------------------------------------------
// Derived helpers — nothing below is stored, all of it is computed at read time
// -----------------------------------------------------------------------------

/** A task is overdue when its due date has passed and it is still open. */
export function isTaskOverdue(task: Pick<CrmTask, "due_at" | "status">, now = Date.now()): boolean {
  if (!task.due_at || task.status === "completed") return false;
  return new Date(task.due_at).getTime() < now;
}

export function isFollowUpOverdue(
  followUp: Pick<CrmFollowUp, "scheduled_at" | "status">,
  now = Date.now(),
): boolean {
  if (followUp.status === "completed") return false;
  return new Date(followUp.scheduled_at).getTime() < now;
}

/** Relative inside a week, absolute beyond it — "in 47d" tells nobody anything. */
export function dueLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "No due date";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "—";

  const diff = target - now;
  const abs = Math.abs(diff);
  if (abs > 7 * 86_400_000) return formatDateTime(iso);

  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "now";
  const unit =
    mins < 60
      ? `${mins}m`
      : abs < 86_400_000
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;

  return diff < 0 ? `${unit} overdue` : `in ${unit}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/** Budget range as a single string; "—" when the buyer has stated neither bound. */
export function budgetRange(
  min: number | null | undefined,
  max: number | null | undefined,
  format: (n: number | null | undefined) => string,
): string {
  if (min === null || min === undefined) return max === null || max === undefined ? "—" : format(max);
  if (max === null || max === undefined) return format(min);
  if (min === max) return format(min);
  return `${format(min)} – ${format(max)}`;
}

/**
 * The ceiling a lead has actually stated, used to total a pipeline column.
 *
 * Null — not zero — when no budget is on record, so an unknown never dilutes
 * the sum into looking like a cheap deal.
 */
export function statedBudget(lead: Pick<CrmLeadRow, "budget_max_inr" | "budget_min_inr">): number | null {
  return lead.budget_max_inr ?? lead.budget_min_inr ?? null;
}

export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

// -----------------------------------------------------------------------------
// Leads
// -----------------------------------------------------------------------------

export interface LeadFilters {
  temperature?: string;
  stage?: string;
  source?: string;
  /** A team member id, or UNASSIGNED. */
  rep?: string;
  minScore?: number;
  q?: string;
}

/**
 * PostgREST's `or=` filter is a comma/parenthesis-delimited mini-language, so a
 * raw search term containing either would change the shape of the filter rather
 * than be matched literally. Strip the delimiters instead of escaping them —
 * none of them are meaningful inside a name or a phone number.
 */
function sanitiseSearch(value: string): string {
  return value.replace(/[,()*\\%]/g, " ").trim().slice(0, 60);
}

export async function listLeads(filters: LeadFilters = {}, limit = 200): Promise<CrmLeadRow[]> {
  let query = db().from("villa_leads").select(LEAD_ROW_SELECT);

  if (isTemperature(filters.temperature)) query = query.eq("lead_temperature", filters.temperature);
  if (isPipelineStage(filters.stage)) query = query.eq("pipeline_stage", filters.stage);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.rep === UNASSIGNED) query = query.is("assigned_to", null);
  else if (filters.rep) query = query.eq("assigned_to", filters.rep);
  if (filters.minScore !== undefined && filters.minScore > 0) {
    query = query.gte("lead_score", filters.minScore);
  }

  const q = filters.q ? sanitiseSearch(filters.q) : "";
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);

  const { data } = await query.order("last_contact_at", { ascending: false }).limit(limit);
  return rows<CrmLeadRow>(data);
}

/** Distinct sources, read off the grouped view so this stays one small row set. */
export async function leadSources(): Promise<string[]> {
  const { data } = await db().from("villa_source_summary").select("source");
  const seen = new Set<string>();
  for (const row of rows<{ source: string | null }>(data)) {
    if (row.source) seen.add(row.source);
  }
  return [...seen].sort();
}

export async function teamMembers(): Promise<TeamRef[]> {
  const { data } = await db()
    .from("villa_team_members")
    .select("id, name, role")
    .eq("is_active", true)
    .order("name");
  return rows<TeamRef>(data);
}

export interface LeadDetail {
  lead: CrmLead;
  messages: CrmMessage[];
  activities: CrmActivity[];
  tasks: CrmTask[];
  followUps: CrmFollowUp[];
  siteVisits: CrmSiteVisit[];
  touchpoints: CrmTouchpoint[];
  team: TeamRef[];
}

export async function leadDetail(id: string): Promise<LeadDetail | null> {
  const { data: leadData } = await db()
    .from("villa_leads")
    .select(
      `*, assignee:villa_team_members(id, name, role),
       project:villa_projects(id, name),
       villa_type:villa_types(id, name, price_inr)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!leadData) return null;
  const lead = leadData as unknown as CrmLead;

  // Every query below is keyed by the same lead id, so none depends on another.
  const [messages, activities, tasks, followUps, siteVisits, touchpoints, team] = await Promise.all([
    db()
      .from("villa_messages")
      .select("id, role, channel, body, media_url, media_kind, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: true })
      .limit(300),
    db()
      .from("villa_activities")
      .select("id, actor, activity_type, description, channel, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(80),
    db().from("villa_tasks").select(TASK_SELECT).eq("lead_id", id).order("due_at", {
      ascending: true,
      nullsFirst: false,
    }),
    db()
      .from("villa_follow_ups")
      .select(FOLLOW_UP_SELECT)
      .eq("lead_id", id)
      .order("scheduled_at", { ascending: true }),
    db()
      .from("villa_site_visits")
      .select(
        "id, scheduled_at, preferred_date, preferred_time, completed_at, visitor_count, visit_type, status, outcome, feedback, notes, created_at, project:villa_projects(name), assignee:villa_team_members(id, name, role)",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    db()
      .from("villa_touchpoints")
      .select("id, channel, campaign, detail, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true })
      .limit(50),
    teamMembers(),
  ]);

  return {
    lead,
    messages: rows<CrmMessage>(messages.data),
    activities: rows<CrmActivity>(activities.data),
    tasks: rows<CrmTask>(tasks.data),
    followUps: rows<CrmFollowUp>(followUps.data),
    siteVisits: rows<CrmSiteVisit>(siteVisits.data),
    touchpoints: rows<CrmTouchpoint>(touchpoints.data),
    team,
  };
}

/**
 * Qualification facts the deterministic score is built from.
 *
 * Deliberately no point values: the score is computed during the conversation
 * from behavioural signals that are not stored on the lead row, so any per-fact
 * arithmetic shown here would be a guess dressed up as a breakdown. What IS
 * knowable is which qualification facts are on record — that is what a rep
 * needs to see, and it is all true.
 */
export interface ScoreSignal {
  group: "Intent" | "Requirements" | "Contactability";
  label: string;
  value: string | null;
}

export function scoreSignals(lead: CrmLead): ScoreSignal[] {
  return [
    {
      group: "Intent",
      label: "Purchase timeline",
      value: lead.purchase_timeline === "unknown" ? null : humanise(lead.purchase_timeline),
    },
    { group: "Intent", label: "Buyer purpose", value: lead.buyer_purpose ? humanise(lead.buyer_purpose) : null },
    {
      group: "Intent",
      label: "Financing",
      value:
        lead.financing_preference && lead.financing_preference !== "undecided"
          ? humanise(lead.financing_preference)
          : null,
    },
    { group: "Requirements", label: "Villa type", value: lead.villa_type?.name ?? null },
    { group: "Requirements", label: "Bedrooms", value: lead.bedrooms ? `${lead.bedrooms} BHK` : null },
    {
      group: "Requirements",
      label: "Budget stated",
      value: statedBudget(lead) === null ? null : "Yes",
    },
    { group: "Requirements", label: "Facing", value: lead.facing_preference },
    { group: "Contactability", label: "Name", value: lead.name },
    { group: "Contactability", label: "Email", value: lead.email },
    {
      group: "Contactability",
      label: "Consent",
      value: lead.opted_out ? null : humanise(lead.consent_status),
    },
  ];
}

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

export interface PipelineCard extends CrmLeadRow {
  /** When this lead entered its current stage, derived — see `pipelineBoard`. */
  stage_since: string;
}

export interface PipelineColumn {
  stage: PipelineStage;
  cards: PipelineCard[];
  /** Sum of stated budgets in THIS column only. */
  valueInr: number;
  /** Cards in this column with no budget on record, so the total reads honestly. */
  unknownBudget: number;
}

export async function pipelineBoard(): Promise<PipelineColumn[]> {
  // villa_leads has no stage_entered_at column. The activity log is the only
  // record of when a lead moved, and a lead with no stage_changed event has
  // never moved — so it has been where it is since it was created.
  const [leadRes, eventRes] = await Promise.all([
    db().from("villa_leads").select(LEAD_ROW_SELECT).order("lead_score", { ascending: false }).limit(500),
    db()
      .from("villa_activities")
      .select("lead_id, created_at")
      .eq("activity_type", "stage_changed")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const lastMove = new Map<string, string>();
  for (const event of rows<{ lead_id: string | null; created_at: string }>(eventRes.data)) {
    if (event.lead_id && !lastMove.has(event.lead_id)) lastMove.set(event.lead_id, event.created_at);
  }

  const columns: PipelineColumn[] = PIPELINE_STAGES.map((stage) => ({
    stage,
    cards: [],
    valueInr: 0,
    unknownBudget: 0,
  }));
  const byStage = new Map(columns.map((c) => [c.stage, c]));

  for (const lead of rows<CrmLeadRow>(leadRes.data)) {
    const column = byStage.get(lead.pipeline_stage);
    // A row carrying a stage this build doesn't know about would otherwise
    // blank the board; drop it rather than crash.
    if (!column) continue;

    column.cards.push({ ...lead, stage_since: lastMove.get(lead.id) ?? lead.created_at });
    const budget = statedBudget(lead);
    if (budget === null) column.unknownBudget += 1;
    else column.valueInr += budget;
  }

  return columns;
}

// -----------------------------------------------------------------------------
// Contacts
// -----------------------------------------------------------------------------

export interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  contact_type: string;
  company: string | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  leadCount: number;
  /** Set when exactly one lead links here, so the row can deep-link to it. */
  leadId: string | null;
}

export interface ContactDirectory {
  contacts: ContactRow[];
  /** Every contact_type present in the table, with its count. */
  types: { type: string; count: number }[];
}

export async function contactDirectory(type?: string): Promise<ContactDirectory> {
  // Linked-lead counts are tallied here rather than with an embedded aggregate
  // because only leads carrying contact_id are genuinely linked — a lead
  // created straight off a webhook may share a phone number without the FK.
  const [contactRes, linkRes] = await Promise.all([
    db().from("villa_contacts").select("*").order("last_seen_at", { ascending: false }).limit(500),
    db().from("villa_leads").select("id, contact_id").not("contact_id", "is", null).limit(2000),
  ]);

  const links = new Map<string, string[]>();
  for (const link of rows<{ id: string; contact_id: string }>(linkRes.data)) {
    const list = links.get(link.contact_id);
    if (list) list.push(link.id);
    else links.set(link.contact_id, [link.id]);
  }

  const all = rows<Omit<ContactRow, "leadCount" | "leadId">>(contactRes.data).map((contact) => {
    const leadIds = links.get(contact.id) ?? [];
    return { ...contact, leadCount: leadIds.length, leadId: leadIds.length === 1 ? leadIds[0] : null };
  });

  const counts = new Map<string, number>();
  for (const contact of all) {
    counts.set(contact.contact_type, (counts.get(contact.contact_type) ?? 0) + 1);
  }

  return {
    contacts: type ? all.filter((c) => c.contact_type === type) : all,
    types: [...counts.entries()]
      .map(([t, count]) => ({ type: t, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// -----------------------------------------------------------------------------
// Customers — anyone holding a booking that was not cancelled
// -----------------------------------------------------------------------------

interface BookingRow {
  id: string;
  booking_number: string;
  lead_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  kyc_complete: boolean;
  value_inr: number;
  amount_paid_inr: number;
  booking_date: string;
  status: string;
  payment_status: string;
  unit: { unit_number: string } | null;
  project: { name: string } | null;
  villa_type: { name: string } | null;
  assignee: { name: string } | null;
}

export interface CustomerRow {
  phone: string;
  name: string;
  email: string | null;
  leadId: string | null;
  bookingCount: number;
  bookingNumbers: string[];
  kycPending: number;
  units: string[];
  projects: string[];
  villaTypes: string[];
  reps: string[];
  totalValueInr: number;
  paidInr: number;
  outstandingInr: number;
  latestStatus: string;
  paymentStatus: string;
  latestBookingDate: string;
}

/**
 * One row per person, not per booking: a repeat buyer holding two units is one
 * customer, and their outstanding balance is the sum across both. Grouped on
 * phone because that is the identifier villa_bookings always carries.
 */
export async function customers(): Promise<CustomerRow[]> {
  const { data } = await db()
    .from("villa_bookings")
    .select(
      `id, booking_number, lead_id, customer_name, customer_phone, customer_email,
       kyc_complete, value_inr, amount_paid_inr, booking_date, status, payment_status,
       unit:villa_units(unit_number), project:villa_projects(name),
       villa_type:villa_types(name), assignee:villa_team_members(name)`,
    )
    .neq("status", "cancelled")
    .order("booking_date", { ascending: false })
    .limit(500);

  const byPhone = new Map<string, CustomerRow>();

  for (const booking of rows<BookingRow>(data)) {
    let customer = byPhone.get(booking.customer_phone);
    if (!customer) {
      customer = {
        phone: booking.customer_phone,
        name: booking.customer_name,
        email: booking.customer_email,
        leadId: booking.lead_id,
        bookingCount: 0,
        bookingNumbers: [],
        kycPending: 0,
        units: [],
        projects: [],
        villaTypes: [],
        reps: [],
        totalValueInr: 0,
        paidInr: 0,
        outstandingInr: 0,
        // Rows arrive newest-first, so the first booking seen is the latest.
        latestStatus: booking.status,
        paymentStatus: booking.payment_status,
        latestBookingDate: booking.booking_date,
      };
      byPhone.set(booking.customer_phone, customer);
    }

    customer.bookingCount += 1;
    customer.bookingNumbers.push(booking.booking_number);
    if (!booking.kyc_complete) customer.kycPending += 1;
    customer.totalValueInr += toInt(booking.value_inr);
    customer.paidInr += toInt(booking.amount_paid_inr);
    customer.email ??= booking.customer_email;
    customer.leadId ??= booking.lead_id;

    pushUnique(customer.units, booking.unit?.unit_number);
    pushUnique(customer.projects, booking.project?.name);
    pushUnique(customer.villaTypes, booking.villa_type?.name);
    pushUnique(customer.reps, booking.assignee?.name);
  }

  for (const customer of byPhone.values()) {
    customer.outstandingInr = customer.totalValueInr - customer.paidInr;
  }

  return [...byPhone.values()].sort((a, b) => b.totalValueInr - a.totalValueInr);
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (value && !list.includes(value)) list.push(value);
}

/** PostgREST serialises bigint as a number, but numeric aggregates as strings. */
function toInt(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// -----------------------------------------------------------------------------
// Tasks & follow-ups
// -----------------------------------------------------------------------------

export async function listTasks(assignedTo?: string, limit = 300): Promise<CrmTask[]> {
  let query = db().from("villa_tasks").select(TASK_SELECT);
  if (assignedTo === UNASSIGNED) query = query.is("assigned_to", null);
  else if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return rows<CrmTask>(data);
}

export async function listFollowUps(assignedTo?: string, limit = 300): Promise<CrmFollowUp[]> {
  let query = db().from("villa_follow_ups").select(FOLLOW_UP_SELECT);
  if (assignedTo === UNASSIGNED) query = query.is("assigned_to", null);
  else if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data } = await query.order("scheduled_at", { ascending: true }).limit(limit);
  return rows<CrmFollowUp>(data);
}

/** Leads offered in the "create task / follow-up" pickers. */
export async function leadOptions(limit = 200): Promise<LeadRef[]> {
  const { data } = await db()
    .from("villa_leads")
    .select("id, name, phone")
    .order("last_contact_at", { ascending: false })
    .limit(limit);
  return rows<LeadRef>(data);
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export type WriteResult = { ok: true } | { ok: false; error: string };

/** Empty → null, unparseable → the literal "invalid" so callers can 400 it. */
function toIso(value: string | null | undefined): string | null | "invalid" {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  return date.toISOString();
}

export async function assignRep(leadId: string, memberId: string | null): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "A lead is required" };

  let name = "nobody";
  if (memberId) {
    const { data } = await db().from("villa_team_members").select("name").eq("id", memberId).maybeSingle();
    if (!data) return { ok: false, error: "That team member no longer exists" };
    name = (data as { name: string }).name;
  }

  const { error } = await db().from("villa_leads").update({ assigned_to: memberId }).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId,
    type: "assigned",
    description: memberId ? `Assigned to ${name}` : "Unassigned",
    actorName: "Console",
  });
  return { ok: true };
}

export async function setStage(leadId: string, stage: string): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "A lead is required" };
  if (!isPipelineStage(stage)) return { ok: false, error: `Unknown pipeline stage: ${stage}` };

  const { error } = await db().from("villa_leads").update({ pipeline_stage: stage }).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  // The board reads days-in-stage back out of this row — see `pipelineBoard`.
  await logActivity({
    leadId,
    type: "stage_changed",
    description: `Pipeline stage moved to ${STAGE_LABELS[stage]}`,
    actorName: "Console",
  });
  return { ok: true };
}

export async function setAiPaused(leadId: string, paused: boolean): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "A lead is required" };

  const { error } = await db().from("villa_leads").update({ ai_paused: paused }).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId,
    type: paused ? "ai_paused" : "ai_resumed",
    description: paused
      ? "AI replies paused — this lead is handled by a human"
      : "AI replies resumed",
    actorName: "Console",
  });
  return { ok: true };
}

export async function setFutureProspect(
  leadId: string,
  isFuture: boolean,
  reconnectAt: string | null,
): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "A lead is required" };

  const iso = toIso(reconnectAt);
  if (iso === "invalid") return { ok: false, error: "Reconnect date is not a valid date" };
  if (isFuture && !iso) return { ok: false, error: "A future prospect needs a reconnect date" };

  const { error } = await db()
    .from("villa_leads")
    .update({ is_future_prospect: isFuture, reconnect_at: isFuture ? iso : null })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId,
    type: "future_prospect",
    description: isFuture
      ? `Parked as a future prospect, reconnect ${formatDateTime(iso)}`
      : "Returned to the active pipeline",
    actorName: "Console",
  });
  return { ok: true };
}

export interface NewTask {
  title: string;
  description?: string | null;
  leadId?: string | null;
  assignedTo?: string | null;
  priority?: string;
  taskType?: string;
  dueAt?: string | null;
}

export async function createTask(input: NewTask): Promise<WriteResult> {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "A task needs a title" };

  const priority = input.priority?.trim() || "medium";
  if (!isTaskPriority(priority)) return { ok: false, error: `Unknown priority: ${priority}` };

  const dueAt = toIso(input.dueAt);
  if (dueAt === "invalid") return { ok: false, error: "Due date is not a valid date/time" };

  const { error } = await db()
    .from("villa_tasks")
    .insert({
      title,
      description: input.description?.trim() || null,
      lead_id: input.leadId || null,
      assigned_to: input.assignedTo || null,
      priority,
      task_type: input.taskType?.trim() || "follow_up",
      due_at: dueAt,
    });
  if (error) return { ok: false, error: error.message };

  if (input.leadId) {
    await logActivity({
      leadId: input.leadId,
      type: "task_created",
      description: `Task created: ${title}`,
      actorName: "Console",
    });
  }
  return { ok: true };
}

export async function completeTask(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "A task id is required" };
  const { error } = await db()
    .from("villa_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function startTask(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "A task id is required" };
  const { error } = await db()
    .from("villa_tasks")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface NewFollowUp {
  leadId: string;
  scheduledAt: string;
  assignedTo?: string | null;
  channel?: string;
  message?: string | null;
  templateName?: string | null;
  notes?: string | null;
}

export async function createFollowUp(input: NewFollowUp): Promise<WriteResult> {
  if (!input.leadId) return { ok: false, error: "A follow-up needs a lead" };

  const scheduledAt = toIso(input.scheduledAt);
  if (scheduledAt === "invalid") return { ok: false, error: "Scheduled time is not a valid date/time" };
  if (!scheduledAt) return { ok: false, error: "A follow-up needs a scheduled time" };

  const channel = input.channel?.trim() || "whatsapp";
  if (!isCommChannel(channel)) return { ok: false, error: `Unknown channel: ${channel}` };

  const { error } = await db()
    .from("villa_follow_ups")
    .insert({
      lead_id: input.leadId,
      assigned_to: input.assignedTo || null,
      scheduled_at: scheduledAt,
      channel,
      message: input.message?.trim() || null,
      template_name: input.templateName?.trim() || null,
      notes: input.notes?.trim() || null,
      ai_generated: false,
    });
  if (error) return { ok: false, error: error.message };

  await logActivity({
    leadId: input.leadId,
    type: "follow_up_scheduled",
    description: `Follow-up scheduled for ${formatDateTime(scheduledAt)} on ${channel}`,
    channel,
    actorName: "Console",
  });
  return { ok: true };
}

export async function completeFollowUp(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "A follow-up id is required" };
  const { error } = await db()
    .from("villa_follow_ups")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
