import { Badge, Card, Empty, PageHeader, SetupNotice, formatNumber, timeAgo, type BadgeTone } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { db } from "@/lib/osf/supabase";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const TEMPLATE_TONE: Record<string, BadgeTone> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  draft: "neutral",
  paused: "warning",
  disabled: "neutral",
};

const BROADCAST_TONE: Record<string, BadgeTone> = {
  completed: "success",
  sending: "info",
  scheduled: "info",
  draft: "neutral",
  paused: "warning",
  failed: "danger",
  cancelled: "neutral",
};

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  variables: number;
  created_at: string;
}

interface BroadcastRow {
  id: string;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  scheduled_for: string | null;
  template: { name: string } | null;
  perf: { delivered: number; read: number } | null;
}

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const page = await gatedLoad({ table: "villa_templates", migration: "003_platform.sql" }, async () => {
    const supabase = db();
    const [templates, broadcasts, perf] = await Promise.all([
      supabase.from("villa_templates").select("*").order("created_at", { ascending: false }),
      supabase
        .from("villa_broadcasts")
        .select("*, template:villa_templates(name)")
        .order("created_at", { ascending: false })
        .limit(25),
      supabase.from("villa_broadcast_performance").select("*"),
    ]);
    const perfById = new Map(
      ((perf.data ?? []) as Array<{ id: string; delivered: number; read: number }>).map((p) => [p.id, p]),
    );
    return {
      templates: (templates.data ?? []) as TemplateRow[],
      broadcasts: ((broadcasts.data ?? []) as unknown as BroadcastRow[]).map((b) => ({
        ...b,
        perf: perfById.get(b.id) ?? null,
      })),
    };
  });

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Broadcasts" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { templates, broadcasts } = page.data;
  const approved = templates.filter((t) => t.status === "approved");

  return (
    <>
      <PageHeader
        title="Broadcasts"
        sub="Template messages to many leads at once. Meta only delivers pre-approved templates outside the 24-hour window, so approval status is tracked per template."
      />

      {error && (
        <p className="mb-4 rounded-lg border border-[--color-danger]/30 bg-[rgba(244,105,95,0.08)] px-4 py-3 text-sm text-[--color-danger]">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Message templates"
          hint="Create here, submit in Meta Business Manager, then mark Approved once Meta approves — sends of unapproved templates are rejected."
        >
          <form method="post" action="/api/osf/marketing/templates" className="mb-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Name (lowercase_underscores)</span>
                <input name="name" required pattern="[a-z0-9_]+" placeholder="site_visit_invite" className="field mt-1" />
              </label>
              <label className="block">
                <span className="label">Language</span>
                <select name="language" className="field mt-1">
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="te">Telugu</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="label">Body — use {"{{1}}"}, {"{{2}}"} for variables</span>
              <textarea
                name="body"
                required
                rows={3}
                placeholder={"Hi {{1}}, Glentree Serenity pre-launch pricing closes soon. Reply YES and we'll hold a site visit slot for you."}
                className="field mt-1"
              />
            </label>
            <button type="submit" className="btn-gold">Save template</button>
          </form>

          {templates.length === 0 ? (
            <Empty>No templates yet.</Empty>
          ) : (
            <ul>
              {templates.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 border-b border-[--color-line] py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t.name} <span className="text-xs text-[--color-muted]">· {t.language} · {t.variables} var</span>
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-[--color-muted]">{t.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={TEMPLATE_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                    {t.status !== "approved" && (
                      <form method="post" action="/api/osf/marketing/templates">
                        <input type="hidden" name="action" value="set_status" />
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button type="submit" className="btn-ghost text-xs" title="Only after Meta approves it in Business Manager">
                          Mark approved
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="New broadcast" hint="Audience filters run at send time; opted-out leads are always excluded.">
          {approved.length === 0 ? (
            <Empty>
              A broadcast needs an approved template. Create one on the left, get it approved by
              Meta, then mark it approved here.
            </Empty>
          ) : (
            <form method="post" action="/api/osf/marketing/broadcasts" className="space-y-3">
              <label className="block">
                <span className="label">Name</span>
                <input name="name" required placeholder="Pre-launch closing reminder" className="field mt-1" />
              </label>
              <label className="block">
                <span className="label">Template</span>
                <select name="template_id" required className="field mt-1">
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language}, {t.variables} variables)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Variables — comma separated; @name pulls the lead&apos;s name</span>
                <input name="variables" placeholder="@name" className="field mt-1" />
              </label>
              <label className="block">
                <span className="label">Audience (JSON) — empty means every opted-in lead</span>
                <textarea
                  name="audience"
                  rows={2}
                  placeholder='{"temperature":["hot","warm"],"createdWithinDays":30}'
                  className="field mt-1 font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="label">Schedule (optional, leave empty to send manually)</span>
                <input name="scheduled_for" type="datetime-local" className="field mt-1" />
              </label>
              <button type="submit" className="btn-gold">Create broadcast</button>
            </form>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Sent and scheduled" hint="Delivery and read counts come from Meta's receipts, not estimates.">
          {broadcasts.length === 0 ? (
            <Empty>No broadcasts yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-[--color-muted]">
                    <th className="pb-2 pr-4">Broadcast</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4 text-right">Audience</th>
                    <th className="pb-2 pr-4 text-right">Sent</th>
                    <th className="pb-2 pr-4 text-right">Delivered</th>
                    <th className="pb-2 pr-4 text-right">Read</th>
                    <th className="pb-2 pr-4 text-right">Failed</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.map((b) => (
                    <tr key={b.id} className="border-t border-[--color-line]">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{b.name}</p>
                        <p className="text-xs text-[--color-muted]">
                          {b.template?.name ?? "—"} · {timeAgo(b.created_at)}
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={BROADCAST_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-right">{formatNumber(b.total)}</td>
                      <td className="py-3 pr-4 text-right">{formatNumber(b.sent)}</td>
                      <td className="py-3 pr-4 text-right">{formatNumber(b.perf?.delivered ?? 0)}</td>
                      <td className="py-3 pr-4 text-right">{formatNumber(b.perf?.read ?? 0)}</td>
                      <td className="py-3 pr-4 text-right">{formatNumber(b.failed)}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {(b.status === "draft" || b.status === "paused") && (
                            <form method="post" action="/api/osf/marketing/broadcasts">
                              <input type="hidden" name="action" value="send" />
                              <input type="hidden" name="id" value={b.id} />
                              <button type="submit" className="btn-gold text-xs">Send now</button>
                            </form>
                          )}
                          {(b.status === "sending" || b.status === "scheduled") && (
                            <form method="post" action="/api/osf/marketing/broadcasts">
                              <input type="hidden" name="action" value="pause" />
                              <input type="hidden" name="id" value={b.id} />
                              <button type="submit" className="btn-ghost text-xs">Pause</button>
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
        </Card>
      </div>
    </>
  );
}
