import { Ban, AlertCircle, CheckCircle, FileText, RefreshCw, AlertTriangle } from "lucide-react";
import { Badge, Card, PageHeader, SetupNotice, timeAgo, type BadgeTone } from "@/components/osf/ui";
import { settingLabel, showOperatorDetail } from "@/lib/whitelabel";
import { gatedLoad } from "@/lib/osf/queries";
import {
  channelRows,
  integrationStatuses,
  type ChannelRow,
  type IntegrationState,
  type IntegrationStatus,
} from "@/lib/osf/settings";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const STATE_LABEL: Record<IntegrationState, string> = {
  connected: "Credentials present",
  not_configured: "Not configured",
  unavailable: "Not built",
};

const STATE_TONE: Record<IntegrationState, BadgeTone> = {
  connected: "success",
  not_configured: "warning",
  unavailable: "neutral",
};

const STATE_ICON = {
  connected: CheckCircle,
  not_configured: AlertCircle,
  unavailable: Ban,
} as const;

/** Category order: what the app cannot run without, then what is optional. */
const CATEGORY_ORDER = ["Data", "AI", "Messaging", "Security", "Automation", "Advertising"];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const page = await gatedLoad({ table: "villa_channel_settings", migration: "001_schema.sql" }, () =>
    Promise.all([channelRows(), integrationStatuses()] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Integrations" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [channels, integrations] = page.data;

  const connected = integrations.filter((i) => i.state === "connected").length;
  const stale = integrations.filter((i) => i.stale);
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: integrations.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);

  const uncategorised = integrations.filter((i) => !CATEGORY_ORDER.includes(i.category));
  if (uncategorised.length > 0) grouped.push({ category: "Other", items: uncategorised });

  const enabledChannels = channels.filter((c) => c.enabled).length;

  return (
    <>
      <PageHeader
        title="Integrations"
        sub={`${connected} of ${integrations.length} have their credentials in place. Every status on this page is read from the environment on this request — never from a stored boolean.`}
      />

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <Card
        gold
        title="How to read this page"
        className="mb-5"
        actions={
          <form action="/api/osf/settings" method="POST">
            <input type="hidden" name="action" value="sync-integrations" />
            <input type="hidden" name="next" value="/inbox/whatsapp/settings/integrations" />
            <button type="submit" className="btn-ghost !py-2 text-xs">
              <RefreshCw size={12} strokeWidth={2} aria-hidden />
              Rewrite stored records
            </button>
          </form>
        }
      >
        <ul className="space-y-2.5 text-sm leading-relaxed text-[var(--color-muted)]">
          <li>
            <span className="text-[var(--color-ink)]">&ldquo;Credentials present&rdquo; is not
            &ldquo;working&rdquo;.</span> It means every environment variable this integration needs is set
            to something that is not a placeholder. Whether the key is valid, unexpired, or scoped
            correctly is decided by the provider on the next call, not here.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">&ldquo;Not built&rdquo; cannot become connected.</span>{" "}
            There is no client code in this repository for those providers, so no key would change
            anything.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Nothing on this page accepts a secret.</span>{" "}
            Credentials live in the server configuration, which only an administrator can reach. A
            form here that took a key would have to store it in a table, which is strictly worse.
          </li>
        </ul>

        {stale.length > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/50 px-4 py-3 text-sm text-[var(--color-warm)]">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {stale.length} stored record{stale.length === 1 ? "" : "s"} disagree with the live configuration (
              {stale.map((s) => s.label).join(", ")}). The environment wins everywhere in this app —
              &ldquo;Rewrite stored records&rdquo; just makes the table say the same thing.
            </span>
          </p>
        )}
      </Card>

      <Card
        title="Publishing channels"
        hint={`${enabledChannels} of ${channels.length} switched on. Enabling a channel adds it to the picker in the content studio — it does not connect an account, because no posting credential exists for any of them.`}
      >
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.channel} channel={channel} />
          ))}
        </div>
      </Card>

      {grouped.map((group) => (
        <Card key={group.category} title={group.category} className="mt-5">
          <div className="grid gap-3 lg:grid-cols-2">
            {group.items.map((integration) => (
              <IntegrationCard key={integration.provider} integration={integration} />
            ))}
          </div>
        </Card>
      ))}

      <Card title="Where the setup steps live" className="mt-5">
        <p className="text-sm leading-relaxed text-[var(--color-muted)]">
          Each card names the heading in{" "}
          <code className="rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-xs">SETUP-GUIDE.md</code> that walks
          through getting that credential — the file sits in the project root, next to{" "}
          <code className="rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-xs">README.md</code>. It is deliberately
          not served over HTTP: it is a guide to handling secrets, and this console is reachable by anyone
          holding the shared password.
        </p>
      </Card>
    </>
  );
}

function ChannelCard({ channel }: { channel: ChannelRow }) {
  return (
    <div
      className={`rounded-xl border p-4 transition ${
        channel.enabled
          ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-void)]/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-ink)]">{channel.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{channel.effect}</p>
        </div>
        <form action="/api/osf/settings" method="POST" className="shrink-0">
          <input type="hidden" name="action" value="set-channel" />
          <input type="hidden" name="channel" value={channel.channel} />
          <input type="hidden" name="enabled" value={channel.enabled ? "false" : "true"} />
          <input type="hidden" name="next" value="/inbox/whatsapp/settings/integrations" />
          <button
            type="submit"
            aria-label={`${channel.enabled ? "Disable" : "Enable"} ${channel.label}`}
            className={`relative h-6 w-11 rounded-full border transition ${
              channel.enabled
                ? "border-[var(--color-gold-line)] bg-[var(--color-gold-600)]"
                : "border-[var(--color-line-strong)] bg-[var(--color-raised)]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--color-ink)] transition-all ${
                channel.enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
        <Badge tone={channel.enabled ? "gold" : "neutral"}>{channel.enabled ? "On" : "Off"}</Badge>
        <Badge tone="neutral">No posting credential</Badge>
        {!channel.stored && <Badge tone="info">Never saved</Badge>}
      </div>
      {channel.notes && <p className="mt-2 text-[11px] text-[var(--color-faint)]">{channel.notes}</p>}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationStatus }) {
  const Icon = STATE_ICON[integration.state];

  return (
    <div className="flex flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-ink)]">{integration.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{integration.role}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Icon
            size={13}
            strokeWidth={2}
            aria-hidden
            className={
              integration.state === "connected"
                ? "text-[var(--color-success)]"
                : integration.state === "not_configured"
                  ? "text-[var(--color-warm)]"
                  : "text-[var(--color-faint)]"
            }
          />
          <Badge tone={STATE_TONE[integration.state]}>{STATE_LABEL[integration.state]}</Badge>
        </span>
      </div>

      {/* Each credential reads as what it is for. The raw variable name is
          operator detail and appears only on a vendor deployment. */}
      {integration.envVars.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {integration.envVars.map((name) => {
            const missing = integration.missing.includes(name);
            return (
              <span
                key={name}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  missing
                    ? "bg-[color-mix(in_oklab,var(--c-warn)_12%,transparent)] text-[var(--color-warm)] line-through decoration-[var(--color-warm)]/50"
                    : "bg-[var(--color-raised)] text-[var(--color-muted)]"
                }`}
                title={missing ? "Not configured" : "Configured"}
              >
                {showOperatorDetail() ? name : settingLabel(name)}
              </span>
            );
          })}
        </div>
      )}

      {integration.unavailable && (
        <p className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          {integration.unavailable}
        </p>
      )}

      {integration.state === "connected" && integration.caveat && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
          <AlertTriangle size={11} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {integration.caveat}
        </p>
      )}

      {integration.stale && (
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-warm)]">
          The stored record says{" "}
          <span className="font-semibold">
            {integration.storedConnected ? "connected" : "disconnected"}
          </span>
          , which the environment contradicts
          {integration.lastSyncAt ? ` — last written ${timeAgo(integration.lastSyncAt)}` : ""}. Nothing
          reads that record to make a decision.
        </p>
      )}

      {/* The setup guide is a file in the vendor's repository, not something a
          client can open — so the pointer only shows on a vendor deployment. */}
      {showOperatorDetail() && (
        <p className="mt-auto flex items-center gap-1.5 pt-3 text-[11px] text-[var(--color-faint)]">
          <FileText size={11} strokeWidth={1.75} aria-hidden />
          SETUP-GUIDE.md &rarr; <span className="text-[var(--color-muted)]">{integration.guide}</span>
        </p>
      )}
    </div>
  );
}
