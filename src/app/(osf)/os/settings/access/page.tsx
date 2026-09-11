import Link from "next/link";
import { Fragment } from "react";
import { Check, KeyRound, Minus, ShieldCheck, AlertTriangle } from "lucide-react";
import { Badge, Card, Empty, PageHeader, SetupNotice, formatDate } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { AccessError, listMemberAccounts, liveMatrix, requirePermission, roleLabel } from "@/lib/osf/rbac";
import { ROLE_LABELS, TEAM_ROLES, isTeamRole } from "@/lib/osf/team";
import { supabaseAuthConfigured } from "@/lib/osf/supabase-auth";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

/**
 * Access management.
 *
 * Two things live here that nothing else in the console could show before:
 *   * which permissions each role *actually* has, read from the same table
 *     Postgres consults — not a diagram of intent;
 *   * who can sign in at all, which is separate from who exists as a team
 *     member. A member with no account is tracked for lead assignment but
 *     cannot open the application.
 *
 * /settings/team keeps the older ROLE_MATRIX view. That one is descriptive and
 * enforces nothing; it predates access control and is left in place rather than
 * quietly deleted.
 */
export default async function AccessPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  // Order matters. Checking this console's own permissions first would tell
  // someone who is correctly signed in that they need to "sign in" — which is
  // both confusing and untrue. Sign-in is Villa-os's, not this module's, so the
  // honest answer is to say where access actually lives.
  const ownAuthInactive = !supabaseAuthConfigured() || process.env.AUTH_MODE === "legacy";

  if (ownAuthInactive) {
    return (
      <>
        <PageHeader title="Access & roles" sub="Sign-in is managed by Villa-os" />
        <Card title="This console does not control who can sign in">
          <p className="text-sm text-[--color-muted]">
            Access to VillaOS is granted by Villa-os&apos;s own session and page rules. This
            module&apos;s per-user sign-in is not active, so nothing shown here would decide who
            gets in.
          </p>
          <p className="mt-3 text-sm text-[--color-muted]">
            Manage people and their access in{" "}
            <Link href="/settings" className="text-[--color-gold-500] underline underline-offset-2">
              Villa-os settings
            </Link>
            .
          </p>
          <p className="mt-3 text-xs text-[--color-faint]">
            The role list below is unavailable until this module&apos;s own accounts are configured.
          </p>
        </Card>
      </>
    );
  }

  try {
    await requirePermission("team:read");
  } catch (e) {
    if (e instanceof AccessError) {
      return (
        <>
          <PageHeader title="Access & roles" />
          <Card>
            <p className="text-sm text-[--color-muted]">{e.message}</p>
          </Card>
        </>
      );
    }
    throw e;
  }

  const page = await gatedLoad(
    { table: "villa_role_permissions", migration: "004_auth_rbac.sql" },
    async () => ({ matrix: await liveMatrix(), accounts: await listMemberAccounts() }),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Access & roles" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { matrix, accounts } = page.data;
  const withoutLogin = accounts.filter((a) => a.isActive && !a.hasLogin);
  const rolesWithNoPermissions = [...new Set(accounts.map((a) => a.role))].filter(
    (role) => !(matrix.byRole[role] ?? []).length,
  );

  const categories = [...new Set(matrix.permissions.map((p) => p.category))];

  return (
    <>
      <PageHeader
        title="Access & roles"
        sub="What each role can do, and who can sign in. These are the rules the database enforces."
      />

      {error && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-[--color-danger]">
            <AlertTriangle size={14} aria-hidden /> {error}
          </p>
        </Card>
      )}

      {/* A role with no permissions locks every holder out of everything. That is
          almost never intended, so it is surfaced rather than left to be found. */}
      {rolesWithNoPermissions.length > 0 && (
        <Card>
          <p className="flex items-start gap-2 text-sm text-[--color-danger]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong>{rolesWithNoPermissions.join(", ")}</strong>{" "}
              {rolesWithNoPermissions.length === 1 ? "has" : "have"} no permissions granted, so
              anyone holding{" "}
              {rolesWithNoPermissions.length === 1 ? "that role" : "those roles"} can sign in but do
              nothing. Grant capabilities below, or move those people to another role.
            </span>
          </p>
        </Card>
      )}

      {/* ---- Accounts -------------------------------------------------------- */}
      <Card
        title="Sign-in accounts"
        hint={`${accounts.filter((a) => a.hasLogin).length} of ${accounts.length} members can sign in`}
      >
        {accounts.length === 0 ? (
          <Empty>No team members yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[--color-line] text-left text-xs uppercase tracking-wide text-[--color-muted]">
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Department</th>
                  <th className="py-2 font-medium">Sign-in</th>
                  <th className="py-2 font-medium">Capabilities</th>
                  <th className="py-2 font-medium">Last seen</th>
                  <th className="py-2 text-right font-medium">Manage</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-[--color-line]/60 last:border-0">
                    <td className="py-2.5">
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-[--color-muted]">{a.email ?? "no email"}</div>
                    </td>
                    <td className="py-2.5">
                      <form action="/api/osf/team" method="POST" className="flex items-center gap-1.5">
                        <input type="hidden" name="action" value="role" />
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="next" value="/os/settings/access" />
                        <select
                          name="role"
                          defaultValue={a.role}
                          className="rounded-md border border-[--color-line] bg-white px-2 py-1 text-xs"
                        >
                          {(isTeamRole(a.role) ? TEAM_ROLES : [a.role as never, ...TEAM_ROLES]).map(
                            (role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? roleLabel(role)}
                              </option>
                            ),
                          )}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-[--color-line] px-2 py-1 text-xs hover:bg-[--color-gold-soft]"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="py-2.5 text-xs text-[--color-muted]">{a.department}</td>
                    <td className="py-2.5">
                      {a.hasLogin ? (
                        <Badge tone="success">Enabled</Badge>
                      ) : (
                        <Badge tone="neutral">No account</Badge>
                      )}
                      {!a.isActive && <Badge tone="danger">Disabled</Badge>}
                    </td>
                    <td className="py-2.5 text-xs text-[--color-muted]">
                      {a.permissionCount === 0 ? (
                        <span className="text-[--color-danger]">none</span>
                      ) : (
                        `${a.permissionCount} granted`
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-[--color-muted]">
                      {a.lastLoginAt ? formatDate(a.lastLoginAt) : "never"}
                    </td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {a.hasLogin ? (
                          <>
                            <form action="/api/osf/team" method="POST" className="flex items-center gap-1">
                              <input type="hidden" name="action" value="reset-password" />
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="next" value="/os/settings/access" />
                              <input
                                name="password"
                                type="password"
                                required
                                minLength={12}
                                placeholder="New password"
                                autoComplete="new-password"
                                className="w-28 rounded-md border border-[--color-line] bg-white px-2 py-1 text-xs"
                              />
                              <button
                                type="submit"
                                className="rounded-md border border-[--color-line] px-2 py-1 text-xs hover:bg-[--color-gold-soft]"
                              >
                                Reset
                              </button>
                            </form>
                            <form action="/api/osf/team" method="POST">
                              <input type="hidden" name="action" value="revoke" />
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="next" value="/os/settings/access" />
                              <button
                                type="submit"
                                title="Deletes the login and ends every active session"
                                className="rounded-md border border-[--color-line] px-2 py-1 text-xs text-[--color-danger] hover:bg-[rgba(220,80,80,0.08)]"
                              >
                                Revoke
                              </button>
                            </form>
                          </>
                        ) : (
                          <form action="/api/osf/team" method="POST" className="flex items-center gap-1">
                            <input type="hidden" name="action" value="provision" />
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="next" value="/os/settings/access" />
                            <input
                              name="password"
                              type="password"
                              required
                              minLength={12}
                              placeholder="Set password"
                              autoComplete="new-password"
                              className="w-28 rounded-md border border-[--color-line] bg-white px-2 py-1 text-xs"
                            />
                            <button
                              type="submit"
                              disabled={!a.email}
                              title={a.email ? undefined : "Add an email address first"}
                              className="flex items-center gap-1 rounded-md bg-[--color-gold-500] px-2 py-1 text-xs text-white hover:bg-[--color-gold-600] disabled:opacity-40"
                            >
                              <KeyRound size={11} aria-hidden /> Create
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {withoutLogin.length > 0 && (
          <p className="mt-3 text-xs text-[--color-muted]">
            {withoutLogin.length} active member(s) have no sign-in account. They still receive lead
            assignments and appear in reports, but cannot open the console.
          </p>
        )}
      </Card>

      {/* ---- Enforced matrix ------------------------------------------------- */}
      <Card
        title="Enforced permissions"
        hint="Read from villa_role_permissions — the same table the database checks on every query"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--color-line] text-left text-xs uppercase tracking-wide text-[--color-muted]">
                <th className="py-2 pr-3 font-medium">Capability</th>
                {matrix.roles.map((role) => (
                  <th key={role} className="px-2 py-2 text-center font-medium">
                    {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <Fragment key={category}>
                  <tr>
                    <td
                      colSpan={matrix.roles.length + 1}
                      className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[--color-faint]"
                    >
                      {category}
                    </td>
                  </tr>
                  {matrix.permissions
                    .filter((p) => p.category === category)
                    .map((permission) => (
                      <tr key={permission.key} className="border-b border-[--color-line]/60">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{permission.label}</div>
                          <div className="text-xs text-[--color-muted]">{permission.description}</div>
                        </td>
                        {matrix.roles.map((role) => {
                          const granted = (matrix.byRole[role] ?? []).includes(permission.key);
                          return (
                            <td key={role} className="px-2 py-2 text-center">
                              {granted ? (
                                <span className="mx-auto grid h-5 w-5 place-items-center rounded-full bg-[--color-gold-soft] text-[--color-gold-300]">
                                  <Check size={12} strokeWidth={3} aria-hidden />
                                </span>
                              ) : (
                                <span className="mx-auto grid h-5 w-5 place-items-center text-[--color-faint]">
                                  <Minus size={11} strokeWidth={2.5} aria-hidden />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 flex items-start gap-2 text-xs text-[--color-muted]">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Sales roles hold <code>loan:read</code> so they can answer &ldquo;where is my
            application?&rdquo;, but not <code>documents:*</code> — a customer&rsquo;s bank
            statements belong to the loan department. Changing a row here changes what the database
            allows immediately, for everyone holding that role.
          </span>
        </p>
      </Card>
    </>
  );
}
