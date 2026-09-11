export type LeadTemperature = "hot" | "warm" | "cold";

export type BuyerPurpose =
  | "self_use"
  | "family"
  | "investment"
  | "second_home"
  | "vacation_home"
  | "rental_income"
  | "nri_purchase"
  | "undecided";

export type PurchaseTimeline =
  | "immediate"
  | "within_1_month"
  | "1_3_months"
  | "3_6_months"
  | "6_12_months"
  | "researching"
  | "unknown";

export type Financing = "cash" | "home_loan" | "combination" | "undecided";

export type HandoffStatus = "none" | "requested" | "notified" | "accepted" | "closed";

export type PipelineStage =
  | "new"
  | "qualifying"
  | "qualified"
  | "site_visit_scheduled"
  | "negotiation"
  | "booked"
  | "lost";

export type AssetKind =
  | "brochure"
  | "floor_plan"
  | "site_plan"
  | "master_plan"
  | "price_sheet"
  | "image"
  | "video"
  | "virtual_tour"
  | "location_map"
  | "other";

export type MessageRole = "customer" | "agent" | "human_agent" | "system";

export type VisitStatus =
  | "requested"
  | "scheduled"
  | "confirmed"
  | "completed"
  | "no_show"
  | "cancelled";

export interface Project {
  id: string;
  slug: string;
  name: string;
  developer: string | null;
  status: string | null;
  expected_delivery: string | null;
  address_line: string | null;
  village: string | null;
  mandal: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  survey_no: string | null;
  maps_url: string | null;
  hmda_permit_no: string | null;
  hmda_permit_date: string | null;
  rera_number: string | null;
  rera_status: string | null;
  total_land_acres: number | null;
  total_units: number | null;
  configurations: string[] | null;
  starting_price_inr: number | null;
  price_per_sft_inr: number | null;
  pricing: Record<string, unknown>;
  price_note: string | null;
  currency: string;
  positioning: string | null;
  usps: unknown;
  amenities: unknown;
  specifications: unknown;
  sustainability: unknown;
  connectivity: unknown;
  social_infrastructure: unknown;
  financing_partners: string[] | null;
  is_active: boolean;
}

export interface VillaType {
  id: string;
  project_id: string;
  name: string;
  plot_area_sqyd: number | null;
  built_up_sft: number | null;
  facing: string | null;
  bedrooms: number | null;
  floors: number | null;
  has_home_theatre: boolean | null;
  private_pool: boolean | null;
  price_inr: number | null;
  verification_note: string | null;
  is_active: boolean;
}

export interface Asset {
  id: string;
  project_id: string;
  villa_type_id: string | null;
  kind: AssetKind;
  title: string;
  description: string | null;
  url: string;
  mime_type: string | null;
  is_ai_generated: boolean;
  version: number;
  is_current: boolean;
}

export interface Faq {
  id: string;
  project_id: string | null;
  question: string;
  answer: string;
  tags: string[] | null;
}

export interface Lead {
  id: string;
  /** Null for Instagram-only leads, which have an instagram_id instead. */
  phone: string | null;
  instagram_id?: string | null;
  last_channel?: string | null;
  name: string | null;
  email: string | null;
  country: string | null;
  city: string | null;
  is_nri: boolean;
  preferred_language: string;
  project_interest: string | null;
  villa_type_interest: string | null;
  bedrooms: number | null;
  budget_min_inr: number | null;
  budget_max_inr: number | null;
  buyer_purpose: BuyerPurpose | null;
  purchase_timeline: PurchaseTimeline;
  financing_preference: Financing | null;
  preferred_location: string | null;
  facing_preference: string | null;
  amenities_of_interest: string[] | null;
  requirements_notes: string | null;
  lead_score: number;
  lead_temperature: LeadTemperature;
  pipeline_stage: PipelineStage;
  source: string;
  campaign: string | null;
  ad_id: string | null;
  creative: string | null;
  keyword: string | null;
  landing_page: string | null;
  utm: Record<string, string>;
  referrer: string | null;
  brochure_sent: boolean;
  floor_plan_sent: boolean;
  price_sheet_sent: boolean;
  video_sent: boolean;
  sales_owner: string | null;
  handoff_status: HandoffStatus;
  handoff_reason: string | null;
  handoff_at: string | null;
  consent_status: string;
  opted_out: boolean;
  opted_out_at: string | null;
  ai_paused: boolean;
  notes: string | null;
  first_contact_at: string;
  last_contact_at: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  lead_id: string;
  channel: string;
  status: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
  summary: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  lead_id: string;
  role: MessageRole;
  body: string | null;
  media_url: string | null;
  media_kind: AssetKind | null;
  wa_message_id: string | null;
  created_at: string;
}

export interface SiteVisit {
  id: string;
  lead_id: string;
  project_id: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  visitor_count: number | null;
  visit_type: string;
  status: VisitStatus;
  special_requirements: string | null;
  notes: string | null;
  created_at: string;
}

export interface Handoff {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  reason: string;
  payload: string;
  notified: boolean;
  notified_at: string | null;
  created_at: string;
}

/** One outbound message the agent decided to send. */
export interface AgentReply {
  text?: string;
  mediaUrl?: string;
  mediaKind?: AssetKind;
  caption?: string;
  /**
   * Tappable quick replies. WhatsApp renders up to 3 as buttons; more than
   * that has to become a list, which is why `listButtonLabel` exists — its
   * presence is what tells the transport which of the two shapes to send.
   */
  options?: ReplyOption[];
  listButtonLabel?: string;
}

export interface ReplyOption {
  /** Comes back verbatim in the webhook when the customer taps it. */
  id: string;
  title: string;
  description?: string;
}
