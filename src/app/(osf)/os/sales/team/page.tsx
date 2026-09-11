import { Power } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatCr,
  formatNumber,
  formatPercent,
} from "@/components/osf/ui";
import { BarsChart } from "@/components/osf/charts";
import { gatedLoad } from "@/lib/osf/queries";
import {
  DEPARTMENTS,
  ROLE_LABELS,
  USER_ROLES,
  formatDay,
  listTeamMembers,
  teamLeaderboard,
  type TeamMemberRow,
  type TeamPerformanceRow,
} from "@/lib/osf/sales";

export const dynamic = "force-dynamic";

export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = await gatedLoad({ table: "villa_team_members", migration: "001_schema.sql" }, () =>
    Promise.all([searchParams, teamLeaderboard(), listTeamMembers()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Team Performance" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [params, leaderboard, members] = page.data;
  const error = typeof params.error === "string" ? params.error : undefined;

  const revenueInr = leaderboard.reduce((sum, r) => sum + r.revenue_inr, 0);
  const bookings = leaderboard.reduce((sum, r) => sum + r.bookings, 0);
  const quotaInr = leaderboard.reduce((sum, r) => sum + (r.quota_inr ?? 0), 0);
  const active = members.filter((m) => m.is_active).length;

  const earners = leaderboard.filter((r) => r.revenue_inr > 0);
  const chart = earners.slice(0, 10).map((r) => ({
    label: r.name,
    revenue: Number((r.revenue_inr / 10_000_000).toFixed(2)),
  }));

  return (
    <>
      <PageHeader
        title="Team Performance"
        sub="Lifetime totals per rep, aggregated from real leads, visits and non-cancelled bookings. Nothing here is a target or an estimate."
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active members" value={active} sub={`${members.length} on record`} />
        <Stat label="Bookings closed" value={bookings} />
        <Stat label="Revenue booked" value={revenueInr > 0 ? formatCr(revenueInr) : "—"} gold />
        <Stat
          label="Quota attainment"
          value={quotaInr > 0 ? formatPercent((revenueInr / quotaInr) * 100, 0) : "—"}
          sub={quotaInr > 0 ? `Against ${formatCr(quotaInr)} of quota` : "No quotas set"}
        />
      </div>

      <Card
        title="Leaderboard"
        hint="Bookings and revenue count only against the rep the booking is assigned to; leads and visits against the rep the lead is assigned to."
        className="mb-5"
      >
        {leaderboard.length === 0 ? (
          <Empty>
            No team members yet. Add the first one below — lead routing, visit coordination and
            booking ownership all hang off this list.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="th w-10">#</th>
                  <th className="th">Member</th>
                  <th className="th text-right">Leads</th>
                  <th className="th text-right">Hot</th>
                  <th className="th text-right">Visits</th>
                  <th className="th text-right">Bookings</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">Conv.</th>
                  <th className="th w-48">Quota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {leaderboard.map((row, i) => (
                  <LeaderRow key={row.id} row={row} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="Revenue by rep"
            hint="In crore, non-cancelled bookings only. Reps with no closed booking are left off rather than drawn as a zero bar."
          >
            {chart.length === 0 ? (
              <Empty>No rep has a booking against their name yet.</Empty>
            ) : (
              <BarsChart
                data={chart}
                keys={[{ key: "revenue", name: "Revenue (₹ Cr)" }]}
                horizontal
                height={Math.max(180, chart.length * 44 + 50)}
              />
            )}
          </Card>
        </div>

        <AddMemberForm />
      </div>

      <Card
        className="mt-5"
        title="Roster"
        hint="Deactivating a member takes them out of lead routing immediately. Their historical bookings and leads stay attributed to them."
      >
        {members.length === 0 ? (
          <Empty>Nobody on the roster yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="th">Name</th>
                  <th className="th">Role</th>
                  <th className="th">Contact</th>
                  <th className="th">Languages</th>
                  <th className="th text-right">Quota</th>
                  <th className="th">Joined</th>
                  <th className="th text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {members.map((m) => (
                  <RosterRow key={m.id} member={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// -----------------------------------------------------------------------------

function LeaderRow({ row, rank }: { row: TeamPerformanceRow; rank: number }) {
  return (
    <tr className="row-hover">
      <td className="td tabular-nums text-[var(--color-faint)]">{rank}</td>
      <td className="td">
        <span className="block font-medium">{row.name}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-faint)]">
          {ROLE_LABELS[row.role] ?? row.role}
        </span>
      </td>
      <td className="td text-right tabular-nums">{formatNumber(row.assigned_leads)}</td>
      <td className="td text-right tabular-nums text-[var(--color-hot)]">
        {row.hot_leads > 0 ? row.hot_leads : <span className="text-[var(--color-faint)]">—</span>}
      </td>
      <td className="td text-right tabular-nums">{formatNumber(row.site_visits)}</td>
      <td className="td text-right tabular-nums">{formatNumber(row.bookings)}</td>
      <td className="td text-right tabular-nums">
        {row.revenue_inr > 0 ? formatCr(row.revenue_inr) : <span className="text-[var(--color-faint)]">—</span>}
      </td>
      <td className="td text-right tabular-nums text-[var(--color-muted)]">
        {formatPercent(row.conversion_rate, 0)}
      </td>
      <td className="td">
        {row.quota_inr && row.quota_inr > 0 ? (
          <>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="tabular-nums text-[var(--color-gold-300)]">
                {formatPercent(row.quota_attainment, 0)}
              </span>
              <span className="tabular-nums text-[var(--color-faint)]">{formatCr(row.quota_inr)}</span>
            </div>
            <Meter value={row.revenue_inr} max={row.quota_inr} />
          </>
        ) : (
          <span className="text-xs text-[var(--color-faint)]">Not on a quota</span>
        )}
      </td>
    </tr>
  );
}

function RosterRow({ member }: { member: TeamMemberRow }) {
  return (
    <tr className={`row-hover ${member.is_active ? "" : "opacity-55"}`}>
      <td className="td">
        <span className="block font-medium">{member.name}</span>
        <span className="mt-0.5 block text-xs capitalize text-[var(--color-faint)]">{member.department}</span>
      </td>
      <td className="td text-[13px] text-[var(--color-muted)]">{ROLE_LABELS[member.role] ?? member.role}</td>
      <td className="td">
        <span className="block text-[13px]">{member.email ?? "—"}</span>
        {member.phone && (
          <span className="mt-0.5 block font-mono text-xs text-[var(--color-faint)]">{member.phone}</span>
        )}
      </td>
      <td className="td">
        {member.languages && member.languages.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {member.languages.map((l) => (
              <Badge key={l}>{l}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-faint)]">—</span>
        )}
      </td>
      <td className="td text-right tabular-nums">
        {member.quota_inr && member.quota_inr > 0 ? (
          formatCr(member.quota_inr)
        ) : (
          <span className="text-[var(--color-faint)]">—</span>
        )}
      </td>
      <td className="td text-xs tabular-nums text-[var(--color-muted)]">{formatDay(member.joined_at)}</td>
      <td className="td text-right">
        <form action="/api/osf/sales" method="POST" className="inline-flex items-center gap-2">
          <input type="hidden" name="action" value="toggle-member" />
          <input type="hidden" name="memberId" value={member.id} />
          <Badge tone={member.is_active ? "success" : "neutral"}>
            {member.is_active ? "Active" : "Inactive"}
          </Badge>
          <button
            type="submit"
            aria-label={member.is_active ? `Deactivate ${member.name}` : `Activate ${member.name}`}
            className="btn-ghost px-2.5 py-1.5"
          >
            <Power size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </form>
      </td>
    </tr>
  );
}

function AddMemberForm() {
  return (
    <Card
      title="Add a team member"
      hint="Quota is optional — leave it blank for anyone not carrying one, and the leaderboard shows no attainment rather than a misleading zero."
    >
      <form action="/api/osf/sales" method="POST" className="space-y-3.5">
        <input type="hidden" name="action" value="add-member" />

        <label className="block">
          <span className="label mb-1.5 block">Name</span>
          <input type="text" name="name" required placeholder="Full name" className="field" />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Role</span>
          <select name="role" defaultValue="property_consultant" className="field">
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Department</span>
          <select name="department" defaultValue="" className="field">
            <option value="">Match the role</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <input type="email" name="email" placeholder="name@glentree.in" className="field" />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Phone</span>
          <input type="tel" name="phone" placeholder="919xxxxxxxxx" className="field" />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Quota (₹)</span>
          <input
            type="number"
            name="quotaInr"
            min={0}
            step={1}
            placeholder="150000000"
            className="field tabular-nums"
          />
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Languages</span>
          <input
            type="text"
            name="languages"
            placeholder="English, Telugu, Hindi"
            className="field"
          />
        </label>

        {/*
          An unchecked checkbox submits nothing, and the handler reads a missing
          acceptsLeads as "default true" so a JSON caller can omit it. This
          hidden field is overwritten by the checkbox when it is ticked, so the
          form always states its intent either way.
        */}
        <input type="hidden" name="acceptsLeads" value="off" />
        <label className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]">
          <input
            type="checkbox"
            name="acceptsLeads"
            value="on"
            defaultChecked
            className="h-4 w-4 rounded border-[var(--color-line-strong)] bg-[var(--color-void)] accent-[var(--color-gold-500)]"
          />
          Accepts routed leads
        </label>

        <button type="submit" className="btn-gold w-full">
          Add member
        </button>
      </form>
    </Card>
  );
}
