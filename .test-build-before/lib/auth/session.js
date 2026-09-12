"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSession = exports.AuthError = exports.PERMISSIONS = exports.cacheKeyFromCookies = exports.clearAllSessions = exports.clearSessionCache = void 0;
exports.readMustChangePassword = readMustChangePassword;
exports.getSession = getSession;
exports.hasPermission = hasPermission;
exports.actorLabel = actorLabel;
exports.requirePermission = requirePermission;
exports.requireSession = requireSession;
exports.requireWorkerSecret = requireWorkerSecret;
exports.assertCustomerAccess = assertCustomerAccess;
exports.assertBrandAccess = assertBrandAccess;
const react_1 = require("react");
const headers_1 = require("next/headers");
const ssr_1 = require("@supabase/ssr");
const client_1 = require("../supabase/client");
const session_cache_1 = require("./session-cache");
var session_cache_2 = require("./session-cache");
Object.defineProperty(exports, "clearSessionCache", { enumerable: true, get: function () { return session_cache_2.clearSessionCache; } });
Object.defineProperty(exports, "clearAllSessions", { enumerable: true, get: function () { return session_cache_2.clearAllSessions; } });
Object.defineProperty(exports, "cacheKeyFromCookies", { enumerable: true, get: function () { return session_cache_2.cacheKeyFromCookies; } });
/**
 * IDENTITY AND PERMISSIONS — one source of truth.
 *
 * Supabase Auth holds the credential. Supabase tables hold the roles and the
 * permissions those roles grant. Nothing else in this application decides who
 * you are or what you may do.
 *
 * The previous design kept a second local password store alongside Supabase.
 * Two credential stores for one person is a security defect regardless of how
 * carefully each is written: disabling an account in one leaves it live in the
 * other, and the weaker one sets the real security level. That store is gone.
 */
exports.PERMISSIONS = [
    "customers.read", "customers.write", "inquiries.create",
    "sales.read", "sales.write",
    "loans.read", "loans.write",
    "documents.read", "documents.verify",
    "marketing.read", "marketing.publish",
    "construction.read", "construction.upload",
    "pricing.read", "pricing.negotiate",
    "analytics.view", "financials.view",
    "audit.view", "users.manage", "workflows.manage",
];
class AuthError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
exports.AuthError = AuthError;
/**
 * Read the forced-rotation flag off a Supabase user.
 *
 * The flag lives in `app_metadata` because `user_metadata` is client-writable:
 * the account holder can call `auth.updateUser({ data: { must_change_password:
 * false } })` against their own session and clear the very flag that is supposed
 * to stop them going on using an administrator-issued temporary password. That
 * made the lock advisory. `app_metadata` can only be written with the service
 * role, so it is the authoritative location.
 *
 * `user_metadata` is still read, but only when `app_metadata` says nothing at
 * all, so accounts provisioned before the move are not locked out of their own
 * rotation. Because the fallback only applies when the authoritative key is
 * absent, a `false` a user wrote for themselves can never override an
 * `app_metadata` `true`.
 */
function readMustChangePassword(user) {
    const authoritative = user.app_metadata?.must_change_password;
    if (authoritative !== undefined && authoritative !== null)
        return authoritative === true;
    return user.user_metadata?.must_change_password === true;
}
/** Reads the Supabase session from request cookies. Never trusts a header. */
async function supabaseFromCookies() {
    if (!(0, client_1.isSupabaseConfigured)())
        return null;
    const store = await (0, headers_1.cookies)();
    return (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => store.getAll(),
            setAll: (list) => {
                try {
                    for (const c of list)
                        store.set(c.name, c.value, c.options);
                }
                catch {
                    /* read-only rendering context */
                }
            },
        },
    });
}
/**
 * Resolve the caller, with the reason when it is not a usable session.
 *
 * Wrapped in React's `cache`, which memoises per request — not across requests.
 * That distinction is the whole point: a session must never be shared between
 * two visitors, but a single page render used to resolve it four or five times
 * over (layout, page, and each server action), paying three sequential network
 * round trips to Supabase every time. Now the first call pays and the rest are
 * free, and revocation still takes effect on the very next request.
 */
exports.resolveSession = (0, react_1.cache)(async () => {
    const sb = await supabaseFromCookies();
    if (!sb)
        return { status: "anonymous" };
    // Cross-request cache, keyed by a digest of the auth cookie. See
    // ./session-cache for the (deliberately narrow) staleness window this opens.
    const authCookies = (await (0, headers_1.cookies)()).getAll().map((c) => ({ name: c.name, value: c.value }));
    const key = (0, session_cache_1.cacheKeyFromCookies)(authCookies);
    if (key) {
        // An expired JWT *with no refresh token* can be recognised without asking
        // anybody. When a refresh token is present the cookie is still good —
        // getUser() renews it — so we must fall through to the network rather than
        // signing the user out once per access-token lifetime.
        const raw = authCookies
            .filter((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"))
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .map((c) => c.value)
            .join("");
        const token = (0, session_cache_1.extractAccessToken)(raw);
        const expired = Boolean(token && (0, session_cache_1.isObviouslyExpired)(token));
        if (expired && !(0, session_cache_1.hasRefreshToken)(raw))
            return { status: "anonymous" };
        if (!expired) {
            const cached = (0, session_cache_1.getCachedSession)(key);
            if (cached)
                return cached;
        }
    }
    const remember = (result) => {
        if (key)
            (0, session_cache_1.setCachedSession)(key, result);
        return result;
    };
    // getUser() re-validates the JWT against Supabase. getSession() would trust
    // whatever is in the cookie, which is forgeable.
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user)
        return { status: "anonymous" };
    const email = data.user.email ?? "";
    const mustChangePassword = readMustChangePassword(data.user);
    // Independent lookups, both keyed on the same id, so they run concurrently
    // rather than one after the other. Saves a full round trip on every render.
    const [profileRes, grantRes] = await Promise.all([
        sb.from("profiles").select("id, org_id, full_name, email, active").eq("id", data.user.id).single(),
        sb.from("user_roles").select("roles(key, role_permissions(permission_key))").eq("profile_id", data.user.id),
    ]);
    const profile = profileRes.data;
    if (!profile)
        return remember({ status: "unprovisioned", email });
    if (!profile.active)
        return remember({ status: "disabled", email: profile.email || email });
    const roles = [];
    const permissions = new Set();
    for (const row of (grantRes.data ?? [])) {
        const list = Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [];
        for (const r of list) {
            roles.push(r.key);
            for (const p of r.role_permissions ?? [])
                permissions.add(p.permission_key);
        }
    }
    return remember({
        status: "active",
        session: {
            userId: profile.id,
            email: profile.email,
            fullName: profile.full_name || profile.email,
            orgId: profile.org_id,
            roles,
            permissions,
            mustChangePassword,
        },
    });
});
/**
 * Resolve the caller. Returns null when there is no usable session — callers
 * decide whether that is an error, so a public page and a protected route can
 * share the same lookup. Use `resolveSession` when the reason matters.
 */
async function getSession() {
    const result = await (0, exports.resolveSession)();
    return result.status === "active" ? result.session : null;
}
function hasPermission(session, permission) {
    return Boolean(session?.permissions.has(permission));
}
/**
 * Who to record against an activity entry.
 *
 * Every write route logged the literal string "user", which says that a human
 * did it and nothing else. A 500-entry ring buffer of anonymous entries is not
 * an audit trail: it cannot answer who disconnected a channel, who moved ad
 * budget, or which of seven accounts published the post — the questions the log
 * exists for. The address is the identifier the profiles table is keyed on for
 * humans, so it is what an investigation can actually join against; the display
 * name is not unique and changes when somebody marries.
 *
 * "unknown" rather than "system" for a missing session, because attributing a
 * person's action to the machine is a worse record than admitting the gap. In
 * practice these call sites sit behind `guard()`, so it does not arise.
 */
function actorLabel(session) {
    return session?.email || session?.userId || "unknown";
}
/**
 * The single guard. Throws rather than returning a boolean, so a forgotten
 * `if` cannot silently grant access.
 */
async function requirePermission(...required) {
    if (!(0, client_1.isSupabaseConfigured)()) {
        throw new AuthError("Authentication is not configured on this deployment.", 503);
    }
    const session = await getSession();
    if (!session)
        throw new AuthError("Sign in to continue.", 401);
    // A session still carrying an administrator-issued temporary password may not
    // act. This used to be enforced by the app layout alone, and a layout only
    // runs for pages: every API route accepted the locked session, so the lock
    // stopped nobody who could call fetch(). It belongs here because this is the
    // one function every guarded route and page already goes through.
    //
    // The two paths out of the lock deliberately do not call it: the sign-in
    // screen resolves the session directly and `rotatePassword` talks to Supabase
    // with its own client, so gating here cannot trap someone with no way to
    // replace the password.
    if (session.mustChangePassword) {
        throw new AuthError("Set a new password before continuing.", 403);
    }
    for (const p of required) {
        if (!session.permissions.has(p)) {
            throw new AuthError(`Your role does not include ${p}.`, 403);
        }
    }
    return session;
}
/** Authenticated, no specific capability required. */
async function requireSession() {
    return requirePermission();
}
/**
 * Server-to-server callers (cron, webhooks) present a shared secret instead of
 * a user session. Compared in constant time; refuses to run at all when the
 * secret is unset, so a missing env var fails closed rather than open.
 */
async function requireWorkerSecret(req) {
    const expected = process.env.WORKER_SECRET;
    if (!expected)
        throw new AuthError("Worker access is not configured.", 503);
    const presented = req.headers.get("x-worker-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
    const { timingSafeEqual } = await Promise.resolve().then(() => __importStar(require("node:crypto")));
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new AuthError("Invalid worker credentials.", 401);
    }
}
/** Row-level scoping mirror of the SQL policies, for service-role reads. */
async function assertCustomerAccess(session, customerId) {
    if (session.permissions.has("analytics.view"))
        return; // managers and admins
    if (!(0, client_1.hasServiceRole)())
        throw new AuthError("Cannot verify record ownership.", 503);
    const { data } = await (0, client_1.adminClient)()
        .from("customers")
        .select("id, org_id, owner_id, loan_officer_id, created_by")
        .eq("id", customerId)
        .single();
    if (!data || data.org_id !== session.orgId)
        throw new AuthError("Not found.", 403);
    const mine = [data.owner_id, data.loan_officer_id, data.created_by].includes(session.userId);
    if (!mine)
        throw new AuthError("This record is not assigned to you.", 403);
}
function assertBrandAccess(session, brandId) {
    const db = require("../db").read();
    const brand = db.brands.find((b) => b.id === brandId);
    if (!brand)
        throw new AuthError("Brand not found", 403);
    if (!session.orgId)
        throw new AuthError("Not found", 403);
}
