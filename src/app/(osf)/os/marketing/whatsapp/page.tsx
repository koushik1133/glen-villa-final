import Link from "next/link";
import { Ban, FileText, Image as ImageIcon, Info, Ruler, Video } from "lucide-react";
import { DonutChart, TrendChart } from "@/components/osf/charts";
import { parseRange, rangeLabel, rangeStartIso, rangeToDays } from "@/components/osf/shell/nav-config";
import {
  Badge,
  Card,
  Empty,
  Meter,
  PageHeader,
  SetupNotice,
  Stat,
  formatNumber,
  formatPercent,
  timeAgo,
} from "@/components/osf/ui";
import { configStatus } from "@/lib/osf/env";
import { languages, tones } from "@/lib/osf/marketing/formats";
import { whatsappChannel } from "@/lib/osf/marketing/studio";
import { gatedLoad, requireTable } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function ratio(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return formatPercent((numerator / denominator) * 100, 1);
}

export default async function WhatsappBroadcastsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);

  // The page's own gate is on villa_messages, but the broadcast card reads
  // villa_content_drafts. Without this second probe a missing drafts table
  // renders as "no drafts yet", which reads as a fact about the business when
  // it is really a fact about the migration.
  const page = await gatedLoad({ table: "villa_messages", migration: "001_schema.sql" }, () =>
    Promise.all([
      whatsappChannel(rangeStartIso(range), rangeToDays(range)),
      requireTable("villa_content_drafts", "001_schema.sql"),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="WhatsApp channel" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [{ metrics, flow, broadcasts }, draftsTable] = page.data;
  const { whatsapp: whatsappConfigured } = configStatus();

  const mix = [
    { label: "AI agent", value: metrics.aiSent },
    { label: "Human agent", value: metrics.humanSent },
    { label: "Customer", value: metrics.received },
  ].filter((d) => d.value > 0);

  const totalMessages = metrics.sent + metrics.received;
  const media = [
    { label: "Brochure", value: metrics.brochureSent, icon: FileText },
    { label: "Floor plan", value: metrics.floorPlanSent, icon: Ruler },
    { label: "Price sheet", value: metrics.priceSheetSent, icon: ImageIcon },
    { label: "Video", value: metrics.videoSent, icon: Video },
  ];
  const maxMedia = Math.max(0, ...media.map((m) => m.value));

  return (
    <>
      <PageHeader
        title="WhatsApp channel"
        sub={`${rangeLabel(range)} — counted from the messages this system actually stored. Delivery, open and read rates are not on this page because nothing here measures them.`}
      />

      {!whatsappConfigured && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] px-4 py-3 text-sm text-[var(--color-gold-100)]">
          <Info size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            The WhatsApp Cloud API credentials are not set, so nothing new can arrive. Anything below is
            historic.{" "}
            <Link href="/os/settings/integrations" className="underline underline-offset-2">
              Check integrations
            </Link>
            .
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Messages sent"
          value={formatNumber(metrics.sent)}
          sub={`${formatNumber(metrics.aiSent)} AI · ${formatNumber(metrics.humanSent)} human`}
        />
        <Stat
          label="Messages received"
          value={formatNumber(metrics.received)}
          sub={`${ratio(metrics.received, totalMessages)} of all traffic`}
        />
        <Stat
          label="Conversations started"
          value={formatNumber(metrics.conversations)}
          sub={`${formatNumber(metrics.openConversations)} still open`}
        />
        <Stat
          gold
          label="Leads from WhatsApp"
          value={formatNumber(metrics.leads)}
          sub={`${formatNumber(metrics.qualifiedLeads)} qualified · ${ratio(metrics.qualifiedLeads, metrics.leads)}`}
        />
        <Stat
          label="Opted out"
          value={formatNumber(metrics.optedOut)}
          sub={`${formatNumber(metrics.aiPaused)} paused for a human`}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card
          title="Message flow"
          hint={`Sent versus received, ${flow.granularity}. A widening gap on the sent side means the agent is talking into silence.`}
          className="xl:col-span-2"
        >
          {totalMessages === 0 ? (
            <Empty>No WhatsApp messages stored in this period.</Empty>
          ) : (
            <TrendChart
              data={flow.points}
              keys={[
                { key: "received", name: "Received" },
                { key: "sent", name: "Sent" },
              ]}
              height={280}
            />
          )}
          {flow.truncated && (
            <p className="mt-3 text-[11px] text-[var(--color-faint)]">
              The row cap was reached — the earliest part of this window is not in the chart.
            </p>
          )}
        </Card>

        <Card title="Who is talking" hint="Every stored WhatsApp message by author.">
          {mix.length === 0 ? <Empty>Nothing stored yet.</Empty> : <DonutChart data={mix} height={280} />}
        </Card>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="Collateral sent"
          hint="Counted from the per-lead flags the agent sets when it sends a file, not from any platform report."
        >
          {maxMedia === 0 ? (
            <Empty>No brochures, floor plans, price sheets or videos have been sent yet.</Empty>
          ) : (
            <ul className="space-y-3.5">
              {media.map((m) => (
                <li key={m.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                      <m.icon size={13} strokeWidth={1.75} aria-hidden className="text-[var(--color-gold-500)]" />
                      {m.label}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--color-muted)]">
                      {formatNumber(m.value)} leads ·{" "}
                      <span className="text-[var(--color-faint)]">{ratio(m.value, metrics.leads)} of WhatsApp leads</span>
                    </span>
                  </div>
                  <Meter value={m.value} max={maxMedia} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
            {formatNumber(metrics.mediaMessages)} stored messages carry a media attachment in either
            direction. That is a message count; the list above is a count of leads that reached each
            milestone at least once.
          </p>
        </Card>

        <Card
          title="Consent and escalation"
          hint="The two numbers that decide whether this channel stays usable."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4">
              <p className="label flex items-center gap-1.5">
                <Ban size={11} strokeWidth={2} aria-hidden />
                Opted out
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                {formatNumber(metrics.optedOut)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                {ratio(metrics.optedOut, metrics.leads)} of WhatsApp leads. The agent refuses to send to
                these numbers, and a broadcast must exclude them too.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4">
              <p className="label">Handed to a human</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                {formatNumber(metrics.handoffs)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                {formatNumber(metrics.aiPaused)} leads currently have the AI paused, so replies to them must
                come from the inbox.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Broadcast copy"
        hint="WhatsApp-format drafts from the studio. Queuing one records the intent; the send itself is done by a person in the WhatsApp Business app."
        className="mt-5"
        actions={
          <Link
            href="/os/marketing/studio?format=whatsapp"
            className="text-xs text-[var(--color-muted)] transition hover:text-[var(--color-gold-300)]"
          >
            Open studio →
          </Link>
        }
      >
        {!draftsTable.ok ? (
          <Empty>{draftsTable.error}</Empty>
        ) : broadcasts.length === 0 ? (
          <Empty
            action={
              <Link href="/os/marketing/studio?format=whatsapp" className="btn-ghost">
                Write one
              </Link>
            }
          >
            No WhatsApp drafts yet.
          </Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {broadcasts.map((b) => (
              <Link
                key={b.id}
                href={`/os/marketing/studio?draft=${b.id}`}
                className="flex flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4 transition hover:border-[var(--color-line-strong)]"
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={b.generated_by_ai ? "gold" : "warning"}>
                    {b.generated_by_ai ? "AI" : "Template"}
                  </Badge>
                  <Badge tone="neutral">{languages.label(b.language)}</Badge>
                </div>
                <p className="text-sm font-semibold leading-snug text-[var(--color-ink)]">{b.headline}</p>
                <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-muted)]">
                  {b.primary_text}
                </p>
                <p className="mt-2.5 text-[11px] text-[var(--color-faint)]">
                  {tones.label(b.tone)} · {timeAgo(b.created_at)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card gold title="What is deliberately missing from this page" className="mt-5">
        <ul className="space-y-2.5 text-sm leading-relaxed text-[var(--color-muted)]">
          <li>
            <span className="text-[var(--color-ink)]">Delivery and read rates.</span> Meta reports those as{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">statuses</code> events on the
            webhook — <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">sent</code>,{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">delivered</code>,{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">read</code>. This app handles only
            inbound message events, and <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">villa_messages</code>{" "}
            has no status column to put them in, so there is no honest number to show.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Broadcast reach and open rate.</span> Template broadcasts
            are sent from the WhatsApp Business app or the Cloud API by hand. Nothing reports back here, so
            a &ldquo;42% open rate&rdquo; on this page would be invented.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Template approval status.</span> Message templates are
            submitted and approved in Meta&apos;s Business Manager. This console has no Business Management
            API access and cannot see their state.
          </li>
          <li>
            Everything above is a count of rows this system wrote itself: messages the webhook stored,
            conversations it opened, flags the agent set on a lead.
          </li>
        </ul>
      </Card>
    </>
  );
}
