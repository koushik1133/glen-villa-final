import Link from "next/link";
import { Card, Empty, PageHeader, SetupNotice, timeAgo } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { activityBadge, listActivities } from "@/lib/osf/activities";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const page = await gatedLoad(
    { table: "villa_activities", migration: "0009_business_os.sql" },
    () => listActivities(150),
  );
  if (!page.ok) {
    return (
      <>
        <PageHeader title="Activity" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const activities = page.data;

  return (
    <>
      <PageHeader
        title="Activity"
        sub="Everything that has happened across every lead, newest first. Logged as it occurs — nothing here is reconstructed after the fact."
      />

      <Card>
        {activities.length === 0 ? (
          <Empty>
            Nothing has happened yet. Activity appears here as leads message in, stages move and
            follow-ups go out.
          </Empty>
        ) : (
          <ol className="space-y-4">
            {activities.map((a) => {
              const badge = activityBadge(a.activity_type);
              const lead = a.villa_leads;
              return (
                <li key={a.id} className="flex gap-3 border-b border-[var(--color-line)] pb-4 last:border-0 last:pb-0">
                  <span className={`pill mt-0.5 h-fit shrink-0 ${badge.className}`}>{badge.label}</span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.description}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
                      {lead ? (
                        <Link href={`/os/crm/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.name ?? `+${lead.phone}`}
                        </Link>
                      ) : (
                        <span>System</span>
                      )}
                      {a.actor && <span>· {a.actor}</span>}
                      {a.channel && <span>· {a.channel}</span>}
                      <span>· {timeAgo(a.created_at)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
