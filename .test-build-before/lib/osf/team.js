"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPARTMENTS = exports.SALES_ROLES = exports.ROLE_LABELS = exports.TEAM_ROLES = void 0;
exports.isTeamRole = isTeamRole;
exports.departmentForRole = departmentForRole;
exports.listTeamMembers = listTeamMembers;
exports.teamPerformance = teamPerformance;
exports.createTeamMember = createTeamMember;
exports.toggleActive = toggleActive;
exports.assignLead = assignLead;
exports.roundRobinAssign = roundRobinAssign;
exports.setRole = setRole;
exports.provisionAuthUser = provisionAuthUser;
exports.resetAuthPassword = resetAuthPassword;
exports.revokeAuthAccess = revokeAuthAccess;
const supabase_1 = require("./supabase");
exports.TEAM_ROLES = [
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
exports.ROLE_LABELS = {
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
exports.SALES_ROLES = [
    "sales_manager",
    "sales_agent",
    "sales_director",
    "property_consultant",
];
const ROLE_SET = new Set(exports.TEAM_ROLES);
function isTeamRole(value) {
    return ROLE_SET.has(value);
}
exports.DEPARTMENTS = [
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
function departmentForRole(role) {
    if (role.startsWith("marketing"))
        return "marketing";
    if (role === "loan_officer")
        return "loan";
    if (role === "construction")
        return "construction";
    if (role === "auditor")
        return "audit";
    if (role === "front_desk")
        return "front_desk";
    if (["owner", "admin", "super_admin", "manager"].includes(role))
        return "management";
    return "sales";
}
async function listTeamMembers() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("*")
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });
    return (data ?? []);
}
/** Reads the villa_team_performance view — every number is an aggregate of real rows. */
async function teamPerformance() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_team_performance")
        .select("*")
        .order("revenue_inr", { ascending: false });
    return (data ?? []).map((row) => {
        const r = row;
        return {
            id: String(r.id),
            name: String(r.name ?? ""),
            role: r.role,
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
async function createTeamMember(input) {
    const name = input.name?.trim();
    if (!name)
        return { ok: false, error: "Name is required" };
    // "viewer" is the default because it is the only role present in BOTH enum
    // definitions this repository carries, and least privilege is the right
    // default for a new account regardless. The previous default, "sales_agent",
    // exists only in the legacy enum and is rejected outright by databases built
    // from 001_schema.sql — adding a member simply failed there.
    const role = input.role?.trim() || "viewer";
    if (!isTeamRole(role))
        return { ok: false, error: `Unknown role: ${role}` };
    const department = input.department?.trim() || departmentForRole(role);
    const { data, error } = await (0, supabase_1.db)()
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
    if (error)
        return { ok: false, error: error.message };
    return { ok: true, id: String(data.id) };
}
/** Flips is_active. An inactive member drops out of round-robin automatically. */
async function toggleActive(id) {
    if (!id)
        return { ok: false, error: "Team member id is required" };
    const { data, error } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("is_active")
        .eq("id", id)
        .maybeSingle();
    if (error)
        return { ok: false, error: error.message };
    if (!data)
        return { ok: false, error: "Team member not found" };
    const next = !data.is_active;
    const { error: updateError } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .update({ is_active: next })
        .eq("id", id);
    if (updateError)
        return { ok: false, error: updateError.message };
    return { ok: true };
}
/** Pass null to unassign. */
async function assignLead(leadId, memberId) {
    if (!leadId)
        return { ok: false, error: "leadId is required" };
    if (memberId) {
        const { data, error } = await (0, supabase_1.db)()
            .from("villa_team_members")
            .select("id, is_active")
            .eq("id", memberId)
            .maybeSingle();
        if (error)
            return { ok: false, error: error.message };
        if (!data)
            return { ok: false, error: "Team member not found" };
        if (!data.is_active) {
            return { ok: false, error: "Cannot assign a lead to an inactive team member" };
        }
    }
    const { error } = await (0, supabase_1.db)()
        .from("villa_leads")
        .update({ assigned_to: memberId })
        .eq("id", leadId);
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
/**
 * Gives a lead the sales member carrying the fewest open leads.
 *
 * "Open" excludes booked and lost: a rep who closed fifty deals has capacity
 * again, so balancing on lifetime volume would starve the best closer.
 */
async function roundRobinAssign(leadId) {
    if (!leadId)
        return { ok: false, error: "leadId is required" };
    const { data: lead, error: leadError } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("id, assigned_to")
        .eq("id", leadId)
        .maybeSingle();
    if (leadError)
        return { ok: false, error: leadError.message };
    if (!lead)
        return { ok: false, error: "Lead not found" };
    const { data: members, error: memberError } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name")
        .eq("is_active", true)
        .eq("accepts_leads", true)
        .in("role", exports.SALES_ROLES)
        .order("joined_at", { ascending: true });
    if (memberError)
        return { ok: false, error: memberError.message };
    const eligible = (members ?? []);
    if (eligible.length === 0) {
        return { ok: false, error: "No active sales member is currently accepting leads" };
    }
    // Re-running this on an already-owned lead must not move it: the customer is
    // mid-conversation with that rep.
    const currentOwner = eligible.find((m) => m.id === lead.assigned_to);
    if (currentOwner)
        return { ok: true, memberId: currentOwner.id, memberName: currentOwner.name };
    const { data: openLeads, error: loadError } = await (0, supabase_1.db)()
        .from("villa_leads")
        .select("assigned_to")
        .not("assigned_to", "is", null)
        .not("pipeline_stage", "in", "(booked,lost)");
    if (loadError)
        return { ok: false, error: loadError.message };
    const load = new Map(eligible.map((m) => [m.id, 0]));
    for (const row of (openLeads ?? [])) {
        const owner = row.assigned_to;
        if (owner && load.has(owner))
            load.set(owner, (load.get(owner) ?? 0) + 1);
    }
    // reduce() keeps the first minimum, and members are ordered by joined_at, so
    // ties resolve to the longest-serving rep rather than at random.
    const winner = eligible.reduce((best, m) => ((load.get(m.id) ?? 0) < (load.get(best.id) ?? 0) ? m : best), eligible[0]);
    const assigned = await assignLead(leadId, winner.id);
    if (!assigned.ok)
        return assigned;
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
async function setRole(id, role) {
    if (!id)
        return { ok: false, error: "Team member id is required" };
    if (!isTeamRole(role))
        return { ok: false, error: `Unknown role: ${role}` };
    const { error } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .update({ role, department: departmentForRole(role) })
        .eq("id", id);
    // A role missing from the database enum surfaces here rather than silently
    // doing nothing — the two enum definitions in this repo make that a real
    // possibility on some deployments.
    if (error)
        return { ok: false, error: error.message };
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
async function provisionAuthUser(memberId, password) {
    if (!memberId)
        return { ok: false, error: "Team member id is required" };
    if (!password || password.length < 12) {
        return { ok: false, error: "Password must be at least 12 characters" };
    }
    const { data: member, error: readError } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, email, auth_user_id")
        .eq("id", memberId)
        .maybeSingle();
    if (readError)
        return { ok: false, error: readError.message };
    if (!member)
        return { ok: false, error: "Team member not found" };
    const row = member;
    if (!row.email)
        return { ok: false, error: "This member has no email address to sign in with" };
    if (row.auth_user_id)
        return { ok: false, error: "This member already has a sign-in account" };
    const { data, error } = await (0, supabase_1.db)().auth.admin.createUser({
        email: row.email,
        password,
        email_confirm: true,
    });
    if (error || !data.user) {
        return { ok: false, error: error?.message ?? "Could not create the account" };
    }
    const { error: linkError } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .update({ auth_user_id: data.user.id })
        .eq("id", memberId);
    if (linkError) {
        // The auth user exists but is not linked, which would leave an account that
        // can authenticate and then be rejected for having no member. Remove it
        // rather than leaving that state behind.
        await (0, supabase_1.db)().auth.admin.deleteUser(data.user.id).catch(() => undefined);
        return { ok: false, error: linkError.message };
    }
    return { ok: true, authUserId: data.user.id };
}
/**
 * Set a new password for a member's account. This is the administrator's reset
 * path — there is no email-based reset, because no mail sender is configured
 * and a reset flow without out-of-band delivery is an account-takeover hole.
 */
async function resetAuthPassword(memberId, password) {
    if (!password || password.length < 12) {
        return { ok: false, error: "Password must be at least 12 characters" };
    }
    const { data: member } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("auth_user_id")
        .eq("id", memberId)
        .maybeSingle();
    const authUserId = member?.auth_user_id;
    if (!authUserId)
        return { ok: false, error: "This member has no sign-in account" };
    const { error } = await (0, supabase_1.db)().auth.admin.updateUserById(authUserId, { password });
    if (error)
        return { ok: false, error: error.message };
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
async function revokeAuthAccess(memberId) {
    const { data: member } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("auth_user_id")
        .eq("id", memberId)
        .maybeSingle();
    const authUserId = member?.auth_user_id;
    if (!authUserId)
        return { ok: false, error: "This member has no sign-in account" };
    const { error } = await (0, supabase_1.db)().auth.admin.deleteUser(authUserId);
    if (error)
        return { ok: false, error: error.message };
    await (0, supabase_1.db)().from("villa_team_members").update({ auth_user_id: null, is_active: false }).eq("id", memberId);
    return { ok: true };
}
