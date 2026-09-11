import {
  Activity,
  Bell,
  Bot,
  Brain,
  Building2,
  BarChart3,
  Clock,
  Contact,
  FileSignature,
  FileText,
  Filter,
  KeyRound,
  GitBranch,
  Grid3X3,
  Home,
  Inbox,
  IndianRupee,
  LayoutDashboard,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Plug,
  Ruler,
  Settings,
  Share2,
  Shield,
  Sparkles,
  CheckSquare,
  KanbanSquare,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * The one nav definition. Sidebar, command palette and mobile drawer all read
 * from here so a route can never exist in one surface and not the others.
 *
 * lucide-react 1.x dropped the old numeric/positional icon aliases, so a few
 * names differ from the ones you'd reach for from memory:
 * KanbanSquare (KanbanSquare), CheckSquare (CheckSquare), FileSignature
 * (FileSignature), Home (Home), Wand2 (Wand2), BarChart3 (BarChart3),
 * Filter (Filter).
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra command-palette search terms that don't belong in the visible label. */
  keywords?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/inbox/whatsapp", label: "Inbox", icon: Inbox, keywords: ["threads", "conversations", "chats"] },
      { href: "/inbox/whatsapp/overview", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "today"] },
      { href: "/inbox/whatsapp/training", label: "Training", icon: Bot, keywords: ["teach", "knowledge", "faqs", "pricing"] },
    ],
  },
  {
    label: "AI",
    items: [
      { href: "/inbox/whatsapp/ai/copilot", label: "Copilot", icon: Sparkles, keywords: ["ask", "chat", "assistant"] },
      { href: "/inbox/whatsapp/ai/insights", label: "Insights", icon: Brain, keywords: ["signals", "analysis"] },
      {
        href: "/inbox/whatsapp/ai/lead-intelligence",
        label: "Lead Intelligence",
        icon: Target,
        keywords: ["scoring", "intent", "objections"],
      },
      {
        href: "/inbox/whatsapp/ai/recommendations",
        label: "Recommendations",
        icon: TrendingUp,
        keywords: ["next best action", "suggestions"],
      },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/inbox/whatsapp/crm/leads", label: "Leads", icon: Users, keywords: ["enquiries", "prospects"] },
      { href: "/inbox/whatsapp/crm/rankings", label: "Client Rankings", icon: Trophy, keywords: ["hot", "warm", "cold", "score", "sentiment", "leaderboard", "intent"] },
      { href: "/inbox/whatsapp/crm/pipeline", label: "Pipeline", icon: KanbanSquare, keywords: ["kanban", "stages", "deals"] },
      { href: "/inbox/whatsapp/crm/contacts", label: "Contacts", icon: Contact, keywords: ["people", "phone"] },
      { href: "/inbox/whatsapp/crm/customers", label: "Customers", icon: UserCheck, keywords: ["buyers", "owners"] },
      { href: "/inbox/whatsapp/crm/tasks", label: "Tasks", icon: CheckSquare, keywords: ["todo", "assignments"] },
      { href: "/inbox/whatsapp/crm/follow-ups", label: "Follow-ups", icon: Clock, keywords: ["reminders", "due", "overdue"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/inbox/whatsapp/sales/site-visits", label: "Site Visits", icon: MapPin, keywords: ["tours", "walkthrough"] },
      { href: "/inbox/whatsapp/sales/bookings", label: "Bookings", icon: FileSignature, keywords: ["agreements", "sold", "tokens"] },
      { href: "/inbox/whatsapp/sales/revenue", label: "Revenue", icon: IndianRupee, keywords: ["collections", "value", "gmv"] },
      { href: "/inbox/whatsapp/sales/team", label: "Team Performance", icon: Trophy, keywords: ["reps", "leaderboard", "quota"] },
    ],
  },
  {
    label: "Properties",
    items: [
      { href: "/inbox/whatsapp/properties/projects", label: "Projects", icon: Building2, keywords: ["developments"] },
      { href: "/inbox/whatsapp/properties/villas", label: "Villas", icon: Home, keywords: ["units", "types", "homes"] },
      { href: "/inbox/whatsapp/properties/inventory", label: "Inventory", icon: Grid3X3, keywords: ["availability", "stock", "plots"] },
      { href: "/inbox/whatsapp/properties/floor-plans", label: "Floor Plans", icon: Ruler, keywords: ["layouts", "sqft", "drawings"] },
      { href: "/inbox/whatsapp/properties/amenities", label: "Amenities", icon: Sparkles, keywords: ["clubhouse", "facilities"] },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/inbox/whatsapp/marketing/studio", label: "Content Studio", icon: Wand2, keywords: ["generate", "copy", "creative"] },
      { href: "/inbox/whatsapp/marketing/overview", label: "Overview", icon: BarChart3, keywords: ["performance", "spend"] },
      { href: "/inbox/whatsapp/marketing/campaigns", label: "Campaigns", icon: Megaphone, keywords: ["ads", "meta", "google"] },
      { href: "/inbox/whatsapp/marketing/broadcasts", label: "Broadcasts", icon: Megaphone, keywords: ["templates", "blast", "bulk", "drip"] },
      { href: "/inbox/whatsapp/marketing/whatsapp", label: "WhatsApp Analytics", icon: MessageCircle, keywords: ["templates", "stats"] },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/inbox/whatsapp/communication/inbox", label: "Inbox", icon: Inbox, keywords: ["unified", "threads", "messages"] },
      { href: "/inbox/whatsapp/communication/whatsapp", label: "WhatsApp", icon: MessageSquare, keywords: ["chats", "conversations"] },
      { href: "/inbox/whatsapp/communication/email", label: "Email", icon: Mail, keywords: ["mail", "outbound"] },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/inbox/whatsapp/automation/workflows", label: "Workflows", icon: Workflow, keywords: ["rules", "triggers", "sequences"] },
      { href: "/inbox/whatsapp/automation/routing", label: "Routing", icon: Share2, keywords: ["assignment", "round robin"] },
      { href: "/inbox/whatsapp/automation/notifications", label: "Notifications", icon: Bell, keywords: ["alerts", "handoffs"] },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/inbox/whatsapp/analytics/attribution", label: "Attribution", icon: GitBranch, keywords: ["sources", "channels", "utm"] },
      { href: "/inbox/whatsapp/analytics/funnel", label: "Filter", icon: Filter, keywords: ["conversion", "drop off"] },
      { href: "/inbox/whatsapp/analytics/sales", label: "Sales Analytics", icon: Activity, keywords: ["velocity", "trends"] },
      { href: "/inbox/whatsapp/analytics/reports", label: "Reports", icon: FileText, keywords: ["export", "csv", "download"] },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/inbox/whatsapp/settings", label: "Settings", icon: Settings, keywords: ["preferences", "config"] },
      { href: "/inbox/whatsapp/settings/team", label: "Team & Roles", icon: Shield, keywords: ["users", "permissions", "access"] },
      { href: "/inbox/whatsapp/settings/access", label: "Access & Sign-in", icon: KeyRound, keywords: ["rbac", "login", "accounts", "permissions", "roles"] },
      { href: "/inbox/whatsapp/settings/integrations", label: "Integrations", icon: Plug, keywords: ["api keys", "webhooks", "meta"] },
      { href: "/inbox/whatsapp/whatsapp", label: "WhatsApp Setup", icon: MessageCircle, keywords: ["go live", "webhook", "meta", "voice", "readiness"] },
      { href: "/inbox/whatsapp/simulator", label: "Simulator", icon: Bot, keywords: ["test", "sandbox", "agent"] },
    ],
  },
];

export interface FlatNavItem extends NavItem {
  group: string;
}

/** Flattened once at module scope — the palette re-filters this on every keystroke. */
export const NAV_ITEMS: FlatNavItem[] = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label })),
);

/**
 * Longest-prefix match, not a per-link `startsWith`.
 *
 * `/inbox/whatsapp/settings/team` is a prefix match for both `/inbox/whatsapp/settings` and itself; picking
 * the longest href means exactly one link ever highlights.
 */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    const matches =
      item.href === "/inbox/whatsapp" ? pathname === "/inbox/whatsapp" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

// -----------------------------------------------------------------------------
// Date range
// -----------------------------------------------------------------------------

export const RANGE_KEYS = ["7d", "30d", "90d", "ytd", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_PRESETS: { key: RangeKey; label: string; short: string }[] = [
  { key: "7d", label: "Last 7 days", short: "7D" },
  { key: "30d", label: "Last 30 days", short: "30D" },
  { key: "90d", label: "Last 90 days", short: "90D" },
  { key: "ytd", label: "Year to date", short: "YTD" },
  { key: "all", label: "All time", short: "ALL" },
];

export const DEFAULT_RANGE: RangeKey = "30d";

/** Narrows an untrusted `?range=` value; anything unrecognised falls back. */
export function parseRange(value: string | string[] | undefined | null): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return RANGE_KEYS.includes(raw as RangeKey) ? (raw as RangeKey) : DEFAULT_RANGE;
}

export function rangeLabel(range: string): string {
  const key = parseRange(range);
  return RANGE_PRESETS.find((p) => p.key === key)!.label;
}

/**
 * Lookback window in days, or null for all time.
 *
 * Every page filters on this rather than rolling its own arithmetic, so "last
 * 30 days" means the same thing on the funnel as it does on revenue. YTD is
 * computed from the calendar year rather than fixed at 365 — on 12 January it
 * must mean twelve days, not the previous January.
 */
export function rangeToDays(range: string): number | null {
  const key = parseRange(range);
  if (key === "all") return null;
  if (key === "ytd") {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000));
  }
  return { "7d": 7, "30d": 30, "90d": 90 }[key];
}

/** ISO timestamp for the start of the window, or null for all time. */
export function rangeStartIso(range: string): string | null {
  const days = rangeToDays(range);
  if (days === null) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
