"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthError = void 0;
exports.authorize = authorize;
exports.sessionFromCookies = sessionFromCookies;
exports.can = can;
exports.permissionsFor = permissionsFor;
exports.assertCustomerAccess = assertCustomerAccess;
exports.canAccessCustomer = canAccessCustomer;
const session_1 = require("../auth/session");
const db_1 = require("../db");
const seed_1 = require("./seed");
const background_1 = require("../background");
exports.AuthError = session_1.AuthError;
/**
 * Old name → the permission actually granted in the database.
 *
 * `document:download` used to sit here mapped to `documents.read`, the same
 * target as `document:read`. The download handler authorised on `document:read`
 * and then re-checked `document:download` as a deliberate "second lock", so the
 * second check tested a condition the first had already proved: it could not
 * fail, for anybody, ever. That is worse than having no second lock, because
 * the comment above the handler said there was one and everybody downstream
 * believed it — including whoever decided a leaked download link was survivable.
 *
 * Making it a genuine distinct check needs a `documents.download` permission
 * row and role grants in the database, not an alias in this table; adding the
 * name here without the grants would deny every download instead. So the alias
 * is gone and the handler now claims only the locks it really has.
 */
const MAP = {
    "customer:read": "customers.read",
    "customer:write": "customers.write",
    "sales:read": "sales.read",
    "sales:write": "sales.write",
    "loan:read": "loans.read",
    "loan:write": "loans.write",
    "document:read": "documents.read",
    "document:review": "documents.verify",
    "admin:read": "analytics.view",
    "admin:write": "users.manage",
    "config:write": "workflows.manage",
    "audit:read": "audit.view",
};
function translate(p) {
    const mapped = MAP[p];
    if (!mapped)
        throw new session_1.AuthError(`Unknown permission: ${p}`, 403);
    return mapped;
}
function project(s) {
    // Display label only. It used to default to SALES_MANAGER for any unknown
    // role, which meant a front-desk account was treated as sales by pages that
    // branched on the label. Now it defaults to the least privileged value and
    // every real decision is made against the permission set.
    const role = s.roles.includes("admin")
        ? "ADMIN"
        : s.roles.includes("loan")
            ? "LOAN_OFFICER"
            : s.permissions.has("sales.write")
                ? "SALES_MANAGER"
                : "NONE";
    return { memberId: s.userId, orgId: s.orgId, role, name: s.fullName, permissions: s.permissions };
}
/**
 * One in-flight roster sync per org. `syncTeamMembers` is itself throttled to
 * 60s, but the throttle is only stamped once the Supabase query returns, so a
 * burst of concurrent requests arriving just after it expires would each start
 * their own query. This collapses them to one.
 */
const rosterSync = new Map();
function kickRosterSync(orgId) {
    if (rosterSync.has(orgId))
        return;
    const p = (0, seed_1.syncTeamMembers)(orgId)
        .catch(() => {
        /* keep the last known roster; syncTeamMembers already swallows its own errors */
    })
        .finally(() => {
        rosterSync.delete(orgId);
    });
    rosterSync.set(orgId, p);
    (0, background_1.keepAlive)(p);
}
async function authorize(_req, ...required) {
    const session = await (0, session_1.requirePermission)(...required.map(translate));
    // Every ops route that can assign work passes through here, so this is the
    // one place that keeps the roster current for `assign()`. It is kicked off
    // without awaiting: the roster is a mirror of Supabase that is at most 60s
    // stale by design, and blocking every ops request on a remote query to
    // refresh a cache it will probably not even read is pure added latency.
    // Authorisation itself is unchanged — `requirePermission` is still awaited.
    //
    // The one case that must still block is a cold roster: with no members mirrored
    // yet, `assign()` would have nobody to pick and the request would silently
    // leave the work unassigned. So await only when there is nothing to serve.
    const cold = !(0, db_1.read)().teamMembers.some((m) => m.orgId === session.orgId);
    if (cold)
        await (0, seed_1.syncTeamMembers)(session.orgId);
    else
        kickRosterSync(session.orgId);
    return project(session);
}
async function sessionFromCookies() {
    const s = await (0, session_1.getSession)();
    return s ? project(s) : null;
}
function can(session, permission) {
    if (!session)
        return false;
    const mapped = MAP[permission];
    return Boolean(mapped && session.permissions.has(mapped));
}
function permissionsFor(_role) {
    // Permissions come from the database now, not from a hardcoded role table.
    return [];
}
async function assertCustomerAccess(session, customerId) {
    await (0, session_1.assertCustomerAccess)({ userId: session.memberId, orgId: session.orgId, permissions: session.permissions, email: "", fullName: session.name, roles: [], mustChangePassword: false }, customerId);
}
/** Async because ownership lives in the database, not in the session. */
async function canAccessCustomer(session, customerId) {
    try {
        await assertCustomerAccess(session, customerId);
        return true;
    }
    catch {
        return false;
    }
}
