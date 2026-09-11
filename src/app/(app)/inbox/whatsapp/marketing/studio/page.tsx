import Link from "next/link";
import { AlertCircle, ExternalLink, Send, Settings } from "lucide-react";
import { Badge, Card, Empty, PageHeader, SetupNotice, formatDate, timeAgo } from "@/components/osf/ui";
import { formats, languages, statuses, tones, EDITABLE_STATUSES } from "@/lib/osf/marketing/formats";
import { queueByDraft, studioData, type PublishEntry, type StudioDraft } from "@/lib/osf/marketing/studio";
import { coreConfig, loadTenant } from "@/lib/osf/settings";
import { gatedLoad } from "@/lib/osf/queries";
import type { Brand } from "./DevicePreview";
import { StudioComposer } from "./StudioComposer";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const QUEUE_STATUS_TONE = {
  pending_manual: "warning",
  posted_manually: "success",
  cancelled: "neutral",
} as const;

const QUEUE_STATUS_LABEL: Record<string, string> = {
  pending_manual: "Waiting for a human",
  posted_manually: "Posted by hand",
  cancelled: "Cancelled",
};

export default async function StudioPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  const page = await gatedLoad({ table: "villa_content_drafts", migration: "001_schema.sql" }, () =>
    Promise.all([studioData(), loadTenant()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Content Studio" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [{ projects, villaTypes, drafts, channels, queue, queueHeadlines }, tenant] = page.data;
  const { gemini } = coreConfig();

  const error = first(sp.error);
  const requested = first(sp.draft);
  const selected = drafts.find((d) => d.id === requested) ?? drafts[0] ?? null;

  const formatParam = first(sp.format);
  const initialFormat = formats.is(formatParam)
    ? formatParam
    : selected
      ? selected.format
      : "post";

  const brand: Brand = {
    name: tenant?.org_name ?? "Your organisation",
    logoUrl: tenant?.logo_url ?? null,
    website: tenant?.website ?? null,
  };

  const enabledChannels = channels.filter((c) => c.enabled);
  const byDraft = queueByDraft(queue);
  const pending = queue.filter((q) => q.status === "pending_manual");
  const settled = queue.filter((q) => q.status !== "pending_manual").slice(0, 8);

  const selectedQueue = selected ? (byDraft.get(selected.id) ?? []) : [];
  const alreadyQueued = new Set(
    selectedQueue.filter((q) => q.status === "pending_manual").map((q) => q.channel),
  );
  const back = selected ? `/inbox/whatsapp/marketing/studio?draft=${selected.id}` : "/inbox/whatsapp/marketing/studio";

  return (
    <>
      <PageHeader
        title="Content Studio"
        sub="Write ad and social copy from the project record, see it in the surface it ships to, then queue it for someone to post. No platform API is connected, so nothing here goes live on its own."
      />

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <StudioComposer
        projects={projects}
        villaTypes={villaTypes}
        brand={brand}
        initialDraft={selected}
        initialFormat={initialFormat}
        geminiConfigured={gemini}
      />

      <Card
        title="Queue for manual posting"
        hint="Writes a row to villa_publish_log and stops. Nobody's Instagram, Page or Ads account is touched — this is a to-do list for a person."
        className="mt-5"
        actions={
          <Link
            href="/inbox/whatsapp/settings/integrations"
            className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] transition hover:text-[var(--color-gold-300)]"
          >
            <Settings size={12} strokeWidth={1.75} aria-hidden />
            Channels
          </Link>
        }
      >
        {!selected ? (
          <Empty>Generate a draft first — there is nothing to queue.</Empty>
        ) : enabledChannels.length === 0 ? (
          <Empty
            action={
              <Link href="/inbox/whatsapp/settings/integrations" className="btn-ghost">
                Open channel settings
              </Link>
            }
          >
            No channel is switched on. Enable the ones your team actually posts to, and they appear here.
          </Empty>
        ) : (
          <form action="/api/osf/marketing/publish" method="POST" className="space-y-4">
            <input type="hidden" name="action" value="queue" />
            <input type="hidden" name="draftId" value={selected.id} />
            <input type="hidden" name="next" value={back} />

            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/50 px-4 py-3">
              <p className="label">Queuing</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">{selected.headline}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                {formats.label(selected.format)} · {tones.label(selected.tone)} ·{" "}
                {languages.label(selected.language)}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {enabledChannels.map((c) => {
                const queued = alreadyQueued.has(c.channel);
                return (
                  <label
                    key={c.channel}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition ${
                      queued
                        ? "border-[var(--color-line)] bg-[var(--color-void)]/40 opacity-60"
                        : "border-[var(--color-line)] bg-[var(--color-void)] hover:border-[var(--color-line-strong)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="channel"
                      value={c.channel}
                      disabled={queued}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-gold-500)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--color-ink)]">{c.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-[var(--color-faint)]">
                        {queued ? "Already in the queue" : "No credential — queued for a human"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-gold">
                <Send size={14} strokeWidth={1.75} aria-hidden />
                Queue for manual posting
              </button>
              <p className="text-xs text-[var(--color-faint)]">
                Reach, impressions and delivery are not recorded — no platform reports them back to this app.
              </p>
            </div>
          </form>
        )}
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="Waiting to be posted"
          hint="Every row is an intention. It becomes a fact only when somebody confirms they posted it."
        >
          {pending.length === 0 ? (
            <Empty>Nothing is waiting. Queue a draft above to add one.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map((entry) => (
                <QueueRow key={entry.id} entry={entry} headline={queueHeadlines.get(entry.draft_id)} back={back} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recently settled" hint="Confirmed posts and cancellations, newest first.">
          {settled.length === 0 ? (
            <Empty>Nothing has been confirmed or cancelled yet.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {settled.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-ink)]">
                      {queueHeadlines.get(entry.draft_id) ?? "Draft removed"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {entry.channel} ·{" "}
                      {entry.published_at ? formatDate(entry.published_at) : timeAgo(entry.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.external_url && (
                      <a
                        href={entry.external_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[var(--color-muted)] transition hover:text-[var(--color-gold-300)]"
                        aria-label="Open the live post"
                      >
                        <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
                      </a>
                    )}
                    <Badge tone={QUEUE_STATUS_TONE[entry.status] ?? "neutral"}>
                      {QUEUE_STATUS_LABEL[entry.status] ?? entry.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Draft library"
        hint={`${drafts.length} most recent drafts. Select one to load it into the preview above.`}
        className="mt-5"
      >
        {drafts.length === 0 ? (
          <Empty>No drafts yet. Fill in the brief above and generate one.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                selected={draft.id === selected?.id}
                queued={byDraft.get(draft.id) ?? []}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function QueueRow({
  entry,
  headline,
  back,
}: {
  entry: PublishEntry;
  headline: string | undefined;
  back: string;
}) {
  return (
    <li className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-ink)]">{headline ?? "Draft removed"}</p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {entry.channel} · queued {timeAgo(entry.created_at)}
          </p>
        </div>
        <Badge tone="warning">Pending</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <form action="/api/osf/marketing/publish" method="POST" className="flex flex-1 flex-wrap items-end gap-2">
          <input type="hidden" name="action" value="mark-posted" />
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="next" value={back} />
          <label className="min-w-[180px] flex-1">
            <span className="label">Live post URL (optional)</span>
            <input
              type="url"
              name="externalUrl"
              placeholder="https://…"
              className="field mt-1 !py-1.5 text-xs"
            />
          </label>
          <button type="submit" className="btn-ghost !px-3 !py-2 text-xs">
            I posted this
          </button>
        </form>

        <form action="/api/osf/marketing/publish" method="POST">
          <input type="hidden" name="action" value="cancel" />
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="next" value={back} />
          <button type="submit" className="btn-ghost !px-3 !py-2 text-xs text-[var(--color-muted)]">
            Cancel
          </button>
        </form>
      </div>
    </li>
  );
}

function DraftCard({
  draft,
  selected,
  queued,
}: {
  draft: StudioDraft;
  selected: boolean;
  queued: PublishEntry[];
}) {
  const pending = queued.filter((q) => q.status === "pending_manual").length;
  const posted = queued.filter((q) => q.status === "posted_manually").length;
  const locked = !(EDITABLE_STATUSES as readonly string[]).includes(draft.status);

  return (
    <article
      className={`flex flex-col rounded-xl border p-4 transition ${
        selected
          ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-void)]/40 hover:border-[var(--color-line-strong)]"
      }`}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="gold">{formats.label(draft.format)}</Badge>
        <Badge tone={draft.generated_by_ai ? "info" : "warning"}>
          {draft.generated_by_ai ? "Generated by AI" : "Template fallback"}
        </Badge>
        {pending > 0 && <Badge tone="warning">{pending} queued</Badge>}
        {posted > 0 && <Badge tone="success">{posted} posted</Badge>}
      </div>

      <Link href={`/inbox/whatsapp/marketing/studio?draft=${draft.id}`} scroll className="group">
        <p className="text-sm font-semibold leading-snug text-[var(--color-ink)] transition group-hover:text-[var(--color-gold-300)]">
          {draft.headline}
        </p>
        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-muted)]">
          {draft.primary_text}
        </p>
      </Link>

      <p className="mt-2.5 text-[11px] text-[var(--color-faint)]">
        {tones.label(draft.tone)} · {languages.label(draft.language)} · {timeAgo(draft.created_at)}
      </p>

      <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-line)] pt-3">
        {locked ? (
          <>
            <Badge tone={draft.status === "published" ? "success" : "info"}>
              {statuses.label(draft.status)}
            </Badge>
            <span className="text-[11px] text-[var(--color-faint)]">Set by the publish queue</span>
          </>
        ) : (
          <form action="/api/osf/marketing/publish" method="POST" className="flex flex-1 items-center gap-2">
            <input type="hidden" name="action" value="set-status" />
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="next" value={`/inbox/whatsapp/marketing/studio?draft=${draft.id}`} />
            <select
              name="status"
              defaultValue={draft.status}
              className="field !w-auto flex-1 !py-1.5 text-xs"
            >
              {EDITABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statuses.label(s)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost !px-3 !py-1.5 text-xs">
              Save
            </button>
          </form>
        )}
      </div>
    </article>
  );
}
