import { Check, AlertCircle, LockKeyhole, Minus, Plus, AlertTriangle } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  formatCr,
  formatDate,
} from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import {
  CAPABILITIES,
  DEPARTMENTS,
  ROLE_MATRIX,
  USER_ROLES,
  USER_ROLE_BLURBS,
  USER_ROLE_LABELS,
  isUserRole,
  listRoster,
  type Grant,
  type TeamRosterMember,
} from "@/lib/osf/settings";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function roleLabel(role: string): string {
  return isUserRole(role) ? USER_ROLE_LABELS[role] : role.replace(/_/g, " ");
}

/** Full / own-records-only / denied, rendered so the three read apart at a glance. */
function GrantCell({ grant }: { grant: Grant }) {
  if (grant === "full") {
    return (
      <span className="mx-auto grid h-5 w-5 place-items-center rounded-full bg-[var(--color-gold-soft)] text-[var(--color-gold-300)]">
        <Check size={12} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (grant === "own") {
    return (
      <span className="mx-auto block w-fit rounded-md bg-[rgba(109,168,232,0.14)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-info)]">
        Own
      </span>
    );
  }
  return (
    <span className="mx-auto grid h-5 w-5 place-items-center text-[var(--color-faint)]">
      <Minus size={11} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

export default async function TeamSettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const page = await gatedLoad({ table: "villa_team_members", migration: "001_schema.sql" }, listRoster);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Team & roles" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const roster = page.data;
  const active = roster.filter((m) => m.is_active);

  return (
    <>
      <PageHeader
        title="Team & roles"
        sub={`${active.length} active of ${roster.length} on the roster. Roles here describe who does what — they are not enforced by this application.`}
      />

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/*
        Placed above the matrix, not below it. A permissions grid is read as a
        statement about access control; if the caveat came after, most people
        would have already drawn the wrong conclusion.
      */}
      <div className="mb-5 rounded-2xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-gold-300)]">
          <AlertTriangle size={15} strokeWidth={2} aria-hidden />
          These roles are labels, not access control
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]">
          This console is gated by <span className="font-semibold">Villa-os&apos;s session</span> and its
          page-access rules, not by anything on this page. Whoever Villa-os lets in can open every page
          here and submit every form, whatever the grid below says. Nothing on this page changes that —
          access is managed in Villa-os settings.
        </p>
        <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/50 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]">
            <LockKeyhole size={12} strokeWidth={2} aria-hidden />
            What real RBAC would take
          </p>
          <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
            <li>
              <span className="text-[var(--color-ink)]">Per-user identity.</span> Supabase Auth or an SSO
              provider issuing a session tied to a person, replacing the one shared password.
            </li>
            <li>
              <span className="text-[var(--color-ink)]">A role on the session.</span> The middleware would have
              to resolve a user id to a{" "}
              <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">villa_team_members</code> row,
              and every route handler and page load would check the capability it needs before acting —
              hiding a nav link is not a permission.
            </li>
            <li>
              <span className="text-[var(--color-ink)]">Database policies.</span> Customer tables have RLS
              enabled with no policy today, and the app reads them with the service-role key, which
              bypasses RLS entirely. Real enforcement means policies keyed on{" "}
              <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">auth.uid()</code> and dropping
              the service-role key from request paths that serve a user.
            </li>
            <li>
              <span className="text-[var(--color-ink)]">An audit trail.</span>{" "}
              <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">villa_activities.actor</code> is
              free text a caller supplies. With identities it would become a foreign key, and &ldquo;who
              reassigned this lead&rdquo; would become answerable.
            </li>
          </ul>
        </div>
      </div>

      <Card
        title="Permission matrix"
        hint="The intended division of labour: full access, access limited to a person's own records, or none. Use it to decide who should do what, and to scope the work if this ever needs enforcing."
      >
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="th sticky left-0 z-10 bg-[var(--color-surface)]">Capability</th>
                {USER_ROLES.map((role) => (
                  <th key={role} className="th text-center">
                    <span className="block leading-tight">{USER_ROLE_LABELS[role]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {CAPABILITIES.map((cap) => (
                <tr key={cap.key} className="row-hover">
                  <td className="td sticky left-0 z-10 bg-[var(--color-surface)]">
                    <span className="font-medium">{cap.label}</span>
                    <span className="mt-0.5 block max-w-[280px] text-xs leading-tight text-[var(--color-muted)]">
                      {cap.detail}
                    </span>
                  </td>
                  {USER_ROLES.map((role) => (
                    <td key={role} className="td text-center">
                      <GrantCell grant={ROLE_MATRIX[role][cap.key] ?? "none"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-muted)]">
          <span className="flex items-center gap-2">
            <GrantCell grant="full" /> Full access
          </span>
          <span className="flex items-center gap-2">
            <GrantCell grant="own" /> Only records assigned to them
          </span>
          <span className="flex items-center gap-2">
            <GrantCell grant="none" /> Not permitted
          </span>
        </div>
      </Card>

      <Card
        title="Roster"
        hint="Who is on the team, what they are called, and the leads they carry. Assignment and the leaderboard read from these rows, so they do have a real effect."
        className="mt-5"
      >
        {roster.length === 0 ? (
          <Empty>Nobody on the roster yet. Add the first person below.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className="th">Person</th>
                  <th className="th">Role</th>
                  <th className="th">Department</th>
                  <th className="th">Lead rotation</th>
                  <th className="th text-right">Quota</th>
                  <th className="th text-right">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {roster.map((member) => (
                  <RosterRow key={member.id} member={member} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card title="Add someone" className="xl:col-span-2">
          <form action="/api/osf/settings" method="POST" className="space-y-4">
            <input type="hidden" name="action" value="add-member" />
            <input type="hidden" name="next" value="/os/settings/team" />

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Name">
                <input name="name" required maxLength={120} className="field" />
              </Labelled>
              <Labelled label="Email" hint="Must be unique — it is the roster's natural key.">
                <input name="email" type="email" className="field" />
              </Labelled>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Labelled label="Phone">
                <input name="phone" maxLength={32} className="field" />
              </Labelled>
              <Labelled label="Role">
                <select name="role" defaultValue="property_consultant" className="field">
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {USER_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </Labelled>
              <Labelled label="Department">
                <select name="department" defaultValue="sales" className="field">
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </Labelled>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                name="acceptsLeads"
                defaultChecked
                className="h-3.5 w-3.5 accent-[var(--color-gold-500)]"
              />
              Include in the round-robin lead rotation
            </label>

            <button type="submit" className="btn-gold">
              <Plus size={14} strokeWidth={2} aria-hidden />
              Add to roster
            </button>
          </form>
        </Card>

        <Card title="What each role means">
          <dl className="space-y-3">
            {USER_ROLES.map((role) => (
              <div key={role}>
                <dt className="text-[13px] font-semibold text-[var(--color-ink)]">{USER_ROLE_LABELS[role]}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted)]">
                  {USER_ROLE_BLURBS[role]}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}

function RosterRow({ member }: { member: TeamRosterMember }) {
  return (
    <tr className={`row-hover ${member.is_active ? "" : "opacity-55"}`}>
      <td className="td">
        <span className="font-medium">{member.name}</span>
        <span className="block text-xs text-[var(--color-muted)]">
          {member.email ?? member.phone ?? "No contact recorded"}
        </span>
        {!member.is_active && (
          <Badge tone="neutral">
            <span className="uppercase tracking-wide">Inactive</span>
          </Badge>
        )}
      </td>
      <td className="td">
        <form action="/api/osf/settings" method="POST" className="flex items-center gap-2">
          <input type="hidden" name="action" value="set-role" />
          <input type="hidden" name="id" value={member.id} />
          <input type="hidden" name="next" value="/os/settings/team" />
          <select name="role" defaultValue={member.role} className="field !w-auto !py-1.5 text-xs">
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {USER_ROLE_LABELS[role]}
              </option>
            ))}
            {!isUserRole(member.role) && (
              <option value={member.role} disabled>
                {roleLabel(member.role)} (not in the enum)
              </option>
            )}
          </select>
          <button type="submit" className="btn-ghost !px-2.5 !py-1.5 text-xs">
            Save
          </button>
        </form>
      </td>
      <td className="td capitalize text-[var(--color-muted)]">{member.department}</td>
      <td className="td">
        {member.accepts_leads ? (
          <Badge tone="success">In rotation</Badge>
        ) : (
          <Badge tone="neutral">Excluded</Badge>
        )}
      </td>
      <td className="td text-right tabular-nums">
        {member.quota_inr ? formatCr(member.quota_inr) : "—"}
      </td>
      <td className="td text-right text-[var(--color-muted)]">{formatDate(member.joined_at)}</td>
    </tr>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] leading-tight text-[var(--color-faint)]">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
