"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Empty, SectionTitle } from "@/components/ui";

/**
 * STAFF ACCOUNTS AND ROLES
 *
 * The screen behind `users.manage`. Everything here goes through
 * /api/ops/users, which re-checks the permission server-side — this component
 * only draws. Nothing about the page being reachable grants anything: an
 * operator who forced their way to the URL would still be refused by the route.
 *
 * Two deliberate choices:
 *
 *  - The one-time password is shown ONCE, in the page, and never stored or
 *    re-fetched. There is no "show password again" because the server does not
 *    keep it either; if it is lost the account is disabled and recreated.
 *  - A role change takes effect on the target's NEXT request, because the
 *    route clears the session cache. It is not deferred to a re-login, so
 *    removing someone's access is immediate.
 */

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  roles: string[];
}

export interface AdminRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

/** A created account's one-time password, held in memory only. */
interface Issued {
  email: string;
  temporaryPassword: string;
}

function when(value: string | null): string {
  if (!value) return "never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function UserAdmin({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  // New-account form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/ops/users", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setError(body.error ?? "Could not load staff accounts.");
        return;
      }
      const data = body.data ?? body;
      setUsers(data.users ?? []);
      setRoles(data.roles ?? []);
      setWarning(data.warning ?? null);
      if (!roleKey && data.roles?.length) setRoleKey(data.roles[0].key);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [roleKey]);

  useEffect(() => {
    void load();
    // load() is stable enough for mount; re-running on roleKey would refetch on
    // every dropdown change for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch("/api/ops/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, fullName, roleKey }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setError(body.error ?? "Could not create the account.");
        return;
      }
      const data = body.data ?? body;
      setIssued({ email: data.email, temporaryPassword: data.temporaryPassword });
      setFullName("");
      setEmail("");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function patch(userId: string, change: { active?: boolean; roleKey?: string }) {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch("/api/ops/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...change }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setError(body.error ?? "Could not apply the change.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  return (
    <div className="space-y-6">
      {warning && (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="warn">unavailable</Badge>
            <div className="min-w-0 text-[12px] text-mist-300">
              Staff accounts cannot be read or created on this install because the
              server is missing its administrative database credential. Everything
              below is read-only until that is configured.
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="bad">error</Badge>
            <div className="min-w-0 text-[12px] text-mist-200">{error}</div>
          </div>
        </Card>
      )}

      {issued && (
        <Card>
          <SectionTitle
            title="One-time password"
            hint="Shown once. Copy it now — it is not stored and cannot be shown again."
          />
          <div className="rounded-lg border border-ink-700 p-3">
            <div className="text-[11px] text-mist-400">{issued.email}</div>
            <div className="mt-1 font-mono text-[15px] font-semibold tracking-wide text-mist-100 break-all">
              {issued.temporaryPassword}
            </div>
            <div className="mt-2 text-[11px] text-mist-400">
              They must change it the first time they sign in.
            </div>
          </div>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => setIssued(null)}>Done</Button>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle title="Add a member of staff" hint="They receive one role and a password they must replace" />
        <form onSubmit={createUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] text-mist-400">Full name</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100"
              placeholder="Priya Rao"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-mist-400">Work email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100"
              placeholder="priya@glentree.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-mist-400">Role</span>
            <select
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100"
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={creating || !roles.length}>
              {creating ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
        {roles.length > 0 && (
          <p className="mt-3 text-[11px] text-mist-400">
            {roleName(roleKey)}
            {roles.find((r) => r.key === roleKey)?.description
              ? ` — ${roles.find((r) => r.key === roleKey)!.description}`
              : ""}
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle title="Staff accounts" hint={`${users.length} ${users.length === 1 ? "person" : "people"}`} />
        {loading ? (
          <div className="text-[12px] text-mist-400">Loading…</div>
        ) : users.length === 0 ? (
          <Empty title="No staff accounts yet" hint="Create the first one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-mist-400">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Role</th>
                  <th className="pb-2 pr-3 font-medium">Last signed in</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === selfId;
                  return (
                    <tr key={u.id} className="border-t border-ink-700 align-middle">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-mist-100">
                          {u.fullName}
                          {isSelf && <span className="ml-2 text-[10px] text-mist-400">(you)</span>}
                        </div>
                        <div className="text-[11px] text-mist-400">{u.email}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <select
                          value={u.roles[0] ?? ""}
                          disabled={busy === u.id}
                          onChange={(e) => patch(u.id, { roleKey: e.target.value })}
                          className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[12px] text-mist-100"
                        >
                          {u.roles.length === 0 && <option value="">No role</option>}
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pr-3 text-mist-300">{when(u.lastLoginAt)}</td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={u.active ? "good" : "warn"}>{u.active ? "active" : "disabled"}</Badge>
                      </td>
                      <td className="py-2.5">
                        {isSelf ? (
                          // The route refuses this too; the button is absent so
                          // nobody discovers the rule by being rejected.
                          <span className="text-[11px] text-mist-400">—</span>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => patch(u.id, { active: !u.active })}
                            disabled={busy === u.id}
                          >
                            {busy === u.id ? "…" : u.active ? "Disable" : "Enable"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-mist-400">
          Disabling an account signs it out everywhere immediately. A role change
          applies on that person&apos;s next action — they do not need to sign in again.
        </p>
      </Card>
    </div>
  );
}
