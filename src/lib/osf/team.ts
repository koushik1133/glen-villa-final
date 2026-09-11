import { db } from "./supabase";

/**
 * Team roster, per-rep performance, and lead ownership.
 *
 * Writes return a result object instead of throwing, so a plain form POST can
 * show the failure on the page rather than blowing up into a 500.
 * Schema: supabase/migrations/0009_business_os.sql.
 */

/**
 * Roles.
 *
 * The first block is the original set. The second adds the departments the
 * platform now covers. Both are kept because this repository carries two
 * conflicting villa_user_role enum definitions (supabase/legacy/0009 vs
 * supabase/migrations/001) and which one is live differs per deployment — see
 * the header of supabase/migrations/004_auth_rbac.sql.
 *
 * What a role may *do* is not defined here. That lives in the
 * villa_role_permissions table so an organisation can change it without a
 * deploy; this list only governs what an admin can pick from.
 */
export type TeamRole =
  | "owner"
  | "admin"
  | "manager"
  | "sales_manager"
  | "sales_agent"
  | "marketing_manager"
  | "marketing_agent"
  | "viewer"
  // Added with role-based access control.
  | "super_admin"
  | "sales_director"
  | "property_consultant"
  | "front_desk"
  | "loan_officer"
  | "construction"
  | "auditor";

export const TEAM_ROLES: TeamRole[] = [
  "owner",
  "admin",
  "super_admin",
  "manager",
  "sales_director",
  "sales_manager",
  "sales_agent",
  "property_consultant",
  "front_desk",
  "marketing_manager",
  "marketing_agent",
  "loan_officer",
  "construction",
  "auditor",
  "viewer",
];

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  super_admin: "Super Admin",
  manager: "Manager",
  sales_director: "Sales Director",
  sales_manager: "Sales Manager",
  sales_agent: "Sales Agent",
  property_consultant: "Property Consultant",
  front_desk: "Front Desk",
  marketing_manager: "Marketing Manager",
  marketing_agent: "Marketing Agent",
  loan_officer: "Loan Officer",
  construction: "Construction",
  auditor: "Auditor",
  viewer: "Viewer",
};

/** Only these roles are ever handed a lead by round-robin. */
export const SALES_ROLES: TeamRole[] = [
  "sales_manager",
  "sales_agent",
  "sales_director",
  "property_consultant",
];

const ROLE_SET = new Set<string>(TEAM_ROLES);

export function isTeamRole(value: string): value is TeamRole {
  return ROLE_SET.has(value);
}

export const DEPARTMENTS = [
  "sales",
  "marketing",
  "operations",
  "management",
  "front_desk",
  "loan",
  "construction",
  "audit",
];

/** Sensible default department for a role, used when the form leaves it blank. */
export function departmentForRole(role: string): string {
  if (role.startsWith("marketing")) return "marketing";
  if (role === "loan_officer") return "loan";
  if (role === "construction") return "construction";
  if (role === "auditor") return "audit";
  if (role === "front_desk") return "front_desk";
  if (["owner", "admin", "super_admin", "manager"].includes(role)) return "management";
  return "sales";
}

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: TeamRole;
  department: string;
  is_active: boolean;
  accepts_leads: boolean;
  joined_at: string;
  created_at: string;
}

export interface TeamPerformance {
  id: string;
  name: string;
  role: TeamRole;
  department: string;
  assigned_leads: number;
  hot_leads: number;
  site_visits: number;
  bookings: number;
  revenue_inr: number;
  conversion_rate: number | null;
}

export type WriteResult = { ok: true } | { ok: false; error: string };

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data } = await db()
    .from("villa_team_members")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as TeamMember[];
}

/** Reads the villa_team_performance view — every number is an aggregate of real rows. */
export async function teamPerformance(): Promise<TeamPerformance[]> {
  const { data } = await db()
    .from("villa_team_performance")
    .select("*")
    .order("revenue_inr", { ascending: false });

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      role: r.role as TeamRole,
      department: String(r.department ?? ""),
      assigned_leads: Number(r.assigned_leads ?? 0),
      hot_leads: Number(r.hot_leads ?? 0),
      site_visits: Number(r.site_visits ?? 0),
      bookings: Number(r.bookings ?? 0),
      revenue_inr: Number(r.revenue_inr ?? 0),
      conversion_rate: r.conversion_rate === null || r.conversion_rate === undefined
        ? null
        : Number(r.conversion_rate),
    };
  });
}

export interface NewTeamMember {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  department?: string;
  acceptsLeads?: boolean;
}

export async function createTeamMember(
  input: NewTeamMember,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Name is required" };

  // "viewer" is the default because it is the only role present in BOTH enum
  // definitions this repository carries, and least privilege is the right
  // default for a new account regardless. The previous default, "sales_agent",
  // exists only in the legacy enum and is rejected outright by databases built
  // from 001_schema.sql — adding a member simply failed there.
  const role = input.role?.trim() || "viewer";
  if (!isTeamRole(role)) return { ok: false, error: `Unknown role: ${role}` };

  const department = input.department?.trim() || departmentForRole(role);

  const { data, error } = await db()
    .from("villa_team_members")
    .insert({
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      role,
      department,
      accepts_leads: input.acceptsLeads ?? true,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String((data as { id: string }).id) };
}

/** Flips is_active. An inactive member drops out of round-robin automatically. */
export async function toggleActive(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Team member id is required" };

  const { data, error } = await db()
    .from("villa_team_members")
    .select("is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Team member not found" };

  const next = !(data as { is_active: boolean }).is_active;
  const { error: updateError } = await db()
    .from("villa_team_members")
    .update({ is_active: next })
    .eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

/** Pass null to unassign. */
export async function assignLead(leadId: string, memberId: string | null): Promise<WriteResult> {
  if (!leadId) return { ok: false, error: "leadId is required" };

  if (memberId) {
    const { data, error } = await db()
      .from("villa_team_members")
      .select("id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Team member not found" };
    if (!(data as { is_active: boolean }).is_active) {
      return { ok: false, error: "Cannot assign a lead to an inactive team member" };
    }
  }

  const { error } = await db()
    .from("villa_leads")
    .update({ assigned_to: memberId })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Gives a lead the sales member carrying the fewest open leads.
 *
 * "Open" excludes booked and lost: a rep who closed fifty deals has capacity
 * again, so balancing on lifetime volume would starve the best closer.
 */
export async function roundRobinAssign(
  leadId: string,
): Promise<{ ok: true; memberId: string; memberName: string } | { ok: false; error: string }> {
  if (!leadId) return { ok: false, error: "leadId is required" };

  const { data: lead, error: leadError } = await db()
    .from("villa_leads")
    .select("id, assigned_to")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) return { ok: false, error: leadError.message };
  if (!lead) return { ok: false, error: "Lead not found" };

  const { data: members, error: memberError } = await db()
    .from("villa_team_members")
    .select("id, name")
    .eq("is_active", true)
    .eq("accepts_leads", true)
    .in("role", SALES_ROLES)
    .order("joined_at", { ascending: true });
  if (memberError) return { ok: false, error: memberError.message };

  const eligible = (members ?? []) as Array<{ id: string; name: string }>;
  if (eligible.length === 0) {
    return { ok: false, error: "No active sales member is currently accepting leads" };
  }

  // Re-running this on an already-owned lead must not move it: the customer is
  // mid-conversation with that rep.
  const currentOwner = eligible.find((m) => m.id === (lead as { assigned_to: string | null }).assigned_to);
  if (currentOwner) return { ok: true, memberId: currentOwner.id, memberName: currentOwner.name };

  const { data: openLeads, error: loadError } = await db()
    .from("villa_leads")
    .select("assigned_to")
    .not("assigned_to", "is", null)
    .not("pipeline_stage", "in", "(booked,lost)");
  if (loadError) return { ok: false, error: loadError.message };

  const load = new Map<string, number>(eligible.map((m) => [m.id, 0]));
  for (const row of (openLeads ?? []) as Array<{ assigned_to: string | null }>) {
    const owner = row.assigned_to;
    if (owner && load.has(owner)) load.set(owner, (load.get(owner) ?? 0) + 1);
  }

  // reduce() keeps the first minimum, and members are ordered by joined_at, so
  // ties resolve to the longest-serving rep rather than at random.
  const winner = eligible.reduce(
    (best, m) => ((load.get(m.id) ?? 0) < (load.get(best.id) ?? 0) ? m : best),
    eligible[0],
  );

  const assigned = await assignLead(leadId, winner.id);
  if (!assigned.ok) return assigned;
  return { ok: true, memberId: winner.id, memberName: winner.name };
}

/* -------------------------------------------------------------------------- */
/* Sign-in accounts                                                            */
/*                                                                             */
/* A team member and a login are separate things. A member row can exist with  */
/* no account (someone tracked for lead assignment who never opens the app),   */
/* and an account is only ever created deliberately by an administrator.       */
/* There is no self-service sign-up.                                           */
/* -------------------------------------------------------------------------- */

/**
 * Change a member's role.
 *
 * Permissions follow from the role via villa_role_permissions, so this single
 * write is what grants or removes access — there is no second place to update.
 */
export async function setRole(id: string, role: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "Team member id is required" };
  if (!isTeamRole(role)) return { ok: false, error: `Unknown role: ${role}` };

  const { error } = await db()
    .from("villa_team_members")
    .update({ role, department: departmentForRole(role) })
    .eq("id", id);

  // A role missing from the database enum surfaces here rather than silently
  // doing nothing — the two enum definitions in this repo make that a real
  // possibility on some deployments.
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Create a Supabase Auth account for an existing member and link it.
 *
 * `email_confirm: true` marks the address confirmed without sending mail: these
 * accounts are created by an administrator who already knows the person, and no
 * SMTP sender is configured. The password is passed straight to Supabase and
 * never stored, logged, or returned.
 */
export async function provisionAuthUser(
  memberId: string,
  password: string,
): Promise<{ ok: true; authUserId: string } | { ok: false; error: string }> {
  if (!memberId) return { ok: false, error: "Team member id is required" };
  if (!password || password.length < 12) {
    return { ok: false, error: "Password must be at least 12 characters" };
  }

  const { data: member, error: readError } = await db()
    .from("villa_team_members")
    .select("id, email, auth_user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!member) return { ok: false, error: "Team member not found" };

  const row = member as { id: string; email: string | null; auth_user_id: string | null };
  if (!row.email) return { ok: false, error: "This member has no email address to sign in with" };
  if (row.auth_user_id) return { ok: false, error: "This member already has a sign-in account" };

  const { data, error } = await db().auth.admin.createUser({
    email: row.email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Could not create the account" };
  }

  const { error: linkError } = await db()
    .from("villa_team_members")
    .update({ auth_user_id: data.user.id })
    .eq("id", memberId);

  if (linkError) {
    // The auth user exists but is not linked, which would leave an account that
    // can authenticate and then be rejected for having no member. Remove it
    // rather than leaving that state behind.
    await db().auth.admin.deleteUser(data.user.id).catch(() => undefined);
    return { ok: false, error: linkError.message };
  }

  return { ok: true, authUserId: data.user.id };
}

/**
 * Set a new password for a member's account. This is the administrator's reset
 * path — there is no email-based reset, because no mail sender is configured
 * and a reset flow without out-of-band delivery is an account-takeover hole.
 */
export async function resetAuthPassword(memberId: string, password: string): Promise<WriteResult> {
  if (!password || password.length < 12) {
    return { ok: false, error: "Password must be at least 12 characters" };
  }

  const { data: member } = await db()
    .from("villa_team_members")
    .select("auth_user_id")
    .eq("id", memberId)
    .maybeSingle();

  const authUserId = (member as { auth_user_id: string | null } | null)?.auth_user_id;
  if (!authUserId) return { ok: false, error: "This member has no sign-in account" };

  const { error } = await db().auth.admin.updateUserById(authUserId, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Revoke sign-in access without deleting the member.
 *
 * The member row is kept so historical lead ownership, tasks and audit rows
 * still resolve to a name. Deleting the auth user is what actually ends every
 * existing session — flipping is_active alone would leave a valid JWT working
 * until it expired.
 */
export async function revokeAuthAccess(memberId: string): Promise<WriteResult> {
  const { data: member } = await db()
    .from("villa_team_members")
    .select("auth_user_id")
    .eq("id", memberId)
    .maybeSingle();

  const authUserId = (member as { auth_user_id: string | null } | null)?.auth_user_id;
  if (!authUserId) return { ok: false, error: "This member has no sign-in account" };

  const { error } = await db().auth.admin.deleteUser(authUserId);
  if (error) return { ok: false, error: error.message };

  await db().from("villa_team_members").update({ auth_user_id: null, is_active: false }).eq("id", memberId);
  return { ok: true };
}
