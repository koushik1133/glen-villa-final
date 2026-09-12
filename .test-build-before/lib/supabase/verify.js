"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySupabaseToken = verifySupabaseToken;
const client_1 = require("./client");
async function verifySupabaseToken(accessToken) {
    if (!(0, client_1.isSupabaseConfigured)() || !accessToken)
        return null;
    const res = await fetch(`${(0, client_1.supabaseUrl)()}/auth/v1/user`, {
        headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
    });
    if (!res.ok)
        return null;
    const user = (await res.json());
    if (!user?.id)
        return null;
    // The token proves identity; the database decides what that identity may do.
    if (!(0, client_1.hasServiceRole)()) {
        return { id: user.id, email: user.email ?? "", fullName: user.email ?? "", orgId: "", roleKeys: [], permissions: [] };
    }
    const admin = (0, client_1.adminClient)();
    const { data: profile } = await admin
        .from("profiles")
        .select("id, org_id, full_name, email, active")
        .eq("id", user.id)
        .single();
    if (!profile || !profile.active)
        return null;
    const { data: grants } = await admin
        .from("user_roles")
        .select("roles(key, role_permissions(permission_key))")
        .eq("profile_id", user.id);
    const roleKeys = [];
    const permissions = new Set();
    for (const row of (grants ?? [])) {
        const roles = Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [];
        for (const r of roles) {
            roleKeys.push(r.key);
            for (const p of r.role_permissions ?? [])
                permissions.add(p.permission_key);
        }
    }
    return {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name || profile.email,
        orgId: profile.org_id,
        roleKeys,
        permissions: [...permissions],
    };
}
