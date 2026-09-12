"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AREA_PERMISSIONS = exports.AccessError = void 0;
exports.allowedEmailDomains = allowedEmailDomains;
exports.emailDomainAllowed = emailDomainAllowed;
exports.currentMember = currentMember;
exports.can = can;
exports.canAny = canAny;
exports.requirePermission = requirePermission;
exports.requireMember = requireMember;
exports.audit = audit;
exports.permissionForPath = permissionForPath;
exports.roleLabel = roleLabel;
exports.liveMatrix = liveMatrix;
exports.setRolePermission = setRolePermission;
exports.listMemberAccounts = listMemberAccounts;
const supabase_1 = require("@/lib/osf/supabase");
const supabase_auth_1 = require("@/lib/osf/supabase-auth");
const env_1 = require("@/lib/osf/env");
class AccessError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "AccessError";
    }
}
exports.AccessError = AccessError;
/**
 * Which email domains may hold an account.
 *
 * Configuration, not a constant: this application is not built for one company.
 * Empty means "no domain restriction". Set AUTH_ALLOWED_EMAIL_DOMAINS to a
 * comma-separated list, e.g. "example.com,partner.example".
 */
function allowedEmailDomains() {
    return ((0, env_1.optional)("AUTH_ALLOWED_EMAIL_DOMAINS") ?? "")
        .split(",")
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean);
}
function emailDomainAllowed(email) {
    const domains = allowedEmailDomains();
    if (!domains.length)
        return true;
    const domain = email.split("@")[1]?.toLowerCase();
    return Boolean(domain && domains.includes(domain));
}
/* -------------------------------------------------------------------------- */
/* Resolving the caller                                                        */
/* -------------------------------------------------------------------------- */
/**
 * The signed-in member, or null.
 *
 * The auth user is read through the request-scoped client (so the JWT is
 * verified by Supabase), then the member row and permission set are read with
 * the service client. That second read deliberately bypasses RLS: resolving
 * "who is this" cannot itself depend on knowing who this is.
 */
async function currentMember() {
    if (!(0, supabase_auth_1.supabaseAuthConfigured)())
        return null;
    let authUserId = null;
    let email = null;
    try {
        const supabase = await (0, supabase_auth_1.serverClient)();
        // getUser() validates the JWT with Supabase. getSession() reads the cookie
        // without verifying it and must never be used for an authorisation decision.
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user)
            return null;
        authUserId = data.user.id;
        email = data.user.email ?? null;
    }
    catch {
        return null;
    }
    const { data: row } = await (0, supabase_1.db)()
        .from("villa_team_members")
        .select("id, name, email, role, department, is_active, auth_user_id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
    let member = row;
    // First sign-in for an admin-created Supabase user: link it to the team
    // member that already exists with the same email. Matching on lower(email)
    // mirrors the unique index, so a case difference cannot create a second
    // identity for one person.
    if (!member && email) {
        const { data: byEmail } = await (0, supabase_1.db)()
            .from("villa_team_members")
            .select("id, name, email, role, department, is_active, auth_user_id")
            .ilike("email", email)
            .is("auth_user_id", null)
            .maybeSingle();
        if (byEmail) {
            await (0, supabase_1.db)().from("villa_team_members").update({ auth_user_id: authUserId }).eq("id", byEmail.id);
            await audit({
                actorId: byEmail.id,
                actorEmail: email,
                action: "auth.account_linked",
                entity: "team_member",
                entityId: byEmail.id,
                metadata: { authUserId },
            });
            member = { ...byEmail, auth_user_id: authUserId };
        }
    }
    // Authenticated with Supabase but not on the team, or disabled. Both are a
    // "no", and both are reported the same way to the caller.
    if (!member || !member.is_active)
        return null;
    const { data: perms } = await (0, supabase_1.db)()
        .from("villa_role_permissions")
        .select("permission_key")
        .eq("role", member.role)
        .eq("allowed", true);
    return {
        id: member.id,
        authUserId: authUserId,
        name: member.name,
        email: member.email,
        role: member.role,
        department: member.department,
        isActive: member.is_active,
        permissions: (perms ?? []).map((p) => p.permission_key),
    };
}
function can(member, permission) {
    return Boolean(member?.permissions.includes(permission));
}
function canAny(member, permissions) {
    return permissions.some((p) => can(member, p));
}
/**
 * The guard every protected route calls. Throws rather than returning a
 * boolean, so a forgotten `if` cannot silently grant access.
 */
async function requirePermission(...permissions) {
    const member = await currentMember();
    if (!member)
        throw new AccessError("Sign in required", 401);
    for (const permission of permissions) {
        if (!can(member, permission)) {
            throw new AccessError(`Your role does not include ${permission}`, 403);
        }
    }
    return member;
}
async function requireMember() {
    const member = await currentMember();
    if (!member)
        throw new AccessError("Sign in required", 401);
    return member;
}
/**
 * Append an audit row. Never throws: an audit write failing must not roll back
 * the business action that succeeded, but it must be visible in the logs.
 */
async function audit(input) {
    try {
        await (0, supabase_1.db)().from("villa_audit_log").insert({
            actor_id: input.actorId ?? null,
            actor_email: input.actorEmail ?? null,
            actor_type: input.actorType ?? "human",
            action: input.action,
            entity: input.entity,
            entity_id: input.entityId ?? null,
            metadata: input.metadata ?? {},
            ip: input.ip ?? null,
        });
    }
    catch (error) {
        console.error("[audit] failed to record", input.action, error);
    }
}
/* -------------------------------------------------------------------------- */
/* Route → permission map                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Which permission a top-level area requires. The middleware uses this for a
 * coarse first cut; every route still performs its own check, because a
 * middleware match is a convenience and not a security boundary.
 */
exports.AREA_PERMISSIONS = [
    { prefix: "/team", permission: "team:read" },
    { prefix: "/admin", permission: "settings:write" },
    { prefix: "/inbox/whatsapp/analytics", permission: "analytics:read" },
    { prefix: "/inbox/whatsapp/marketing", permission: "marketing:read" },
    { prefix: "/construction", permission: "construction:read" },
    { prefix: "/loans", permission: "loan:read" },
    { prefix: "/audit", permission: "audit:read" },
];
function permissionForPath(pathname) {
    const match = exports.AREA_PERMISSIONS.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
    return match?.permission ?? null;
}
/** Human-readable role label, used in the UI. */
function roleLabel(role) {
    return role
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
/**
 * Read the enforced role/permission matrix.
 *
 * This is the same table villa_can() consults inside Postgres, so what an admin
 * sees on screen is what the database will actually allow. src/lib/settings.ts
 * carries a separate ROLE_MATRIX constant that predates access control — that
 * one is descriptive documentation and enforces nothing; this one is the rule.
 */
async function liveMatrix() {
    const [{ data: catalogue }, { data: grants }] = await Promise.all([
        (0, supabase_1.db)().from("villa_permissions").select("key, label, description, category").order("category").order("key"),
        (0, supabase_1.db)().from("villa_role_permissions").select("role, permission_key").eq("allowed", true),
    ]);
    const byRole = {};
    for (const row of (grants ?? [])) {
        (byRole[row.role] ??= []).push(row.permission_key);
    }
    return {
        permissions: (catalogue ?? []),
        byRole,
        roles: Object.keys(byRole).sort(),
    };
}
/** Grant or revoke one capability for one role. Takes effect immediately. */
async function setRolePermission(role, permission, allowed) {
    const { error } = await (0, supabase_1.db)()
        .from("villa_role_permissions")
        .upsert({ role, permission_key: permission, allowed, updated_at: new Date().toISOString() }, {
        onConflict: "role,permission_key",
    });
    if (error)
        return { ok: false, error: error.message };
    return { ok: true };
}
async function listMemberAccounts() {
    const [{ data: members }, matrix] = await Promise.all([
        (0, supabase_1.db)()
            .from("villa_team_members")
            .select("id, name, email, role, department, is_active, auth_user_id, last_login_at")
            .order("is_active", { ascending: false })
            .order("name"),
        liveMatrix(),
    ]);
    return (members ?? []).map((m) => ({
        id: String(m.id),
        name: String(m.name ?? ""),
        email: m.email ?? null,
        role: String(m.role ?? ""),
        department: String(m.department ?? ""),
        isActive: Boolean(m.is_active),
        hasLogin: Boolean(m.auth_user_id),
        lastLoginAt: m.last_login_at ?? null,
        permissionCount: (matrix.byRole[String(m.role ?? "")] ?? []).length,
    }));
}
