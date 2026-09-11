import Link from "next/link";
import { AtSign, Ban, AlertCircle, Mail, Plug } from "lucide-react";
import {
  Badge,
  Card,
  Empty,
  PageHeader,
  SetupNotice,
  Stat,
  TemperaturePill,
  formatNumber,
  timeAgo,
} from "@/components/osf/ui";
import { leadsWithEmail, type EmailLead } from "@/lib/osf/communication";
import { humanise } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";
import MailtoComposer, { type ComposerLead } from "./MailtoComposer";

export const dynamic = "force-dynamic";

/**
 * Email, honestly.
 *
 * No email provider is connected to this product — there is no API key, no
 * verified sending domain, and no delivery webhook. So this page does not
 * pretend to send. It shows who could be emailed, drafts the message, and hands
 * it to the rep's own mail client through a `mailto:` link, which needs no
 * credentials at all. What real dispatch would require is spelled out below
 * rather than hidden behind a button that quietly does nothing.
 */

/** What a provider integration would actually cost to stand up. */
const PROVIDER_REQUIREMENTS = [
  {
    title: "A provider account",
    detail:
      "A transactional email service. Each gives an API key and a monthly send allowance; none is wired in here.",
  },
  {
    title: "A verified sending domain",
    detail:
      "SPF, DKIM and a DMARC record on the company domain. Sending villa pricing from an unverified domain lands it in spam and damages the domain's reputation for everything else.",
  },
  {
    title: "Unsubscribe and suppression",
    detail:
      "A one-click unsubscribe header, plus a suppression list the console honours before every send. villa_leads already carries opted_out — the sender would have to respect it.",
  },
  {
    title: "Delivery webhooks",
    detail:
      "Bounces, complaints and deliveries posted back so the console can show what actually arrived, the way villa_messages already does for WhatsApp.",
  },
];

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: preselected } = await searchParams;

  const page = await gatedLoad(null, () => leadsWithEmail(200));

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Email" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const leads = page.data;
  const contactable = leads.filter((lead) => !lead.opted_out);
  const optedOut = leads.length - contactable.length;
  const hot = contactable.filter((lead) => lead.lead_temperature === "hot").length;
  const domains = new Set(
    leads.map((lead) => lead.email.split("@")[1]?.toLowerCase()).filter(Boolean),
  ).size;

  const composerLeads: ComposerLead[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    email: lead.email,
    optedOut: lead.opted_out,
  }));

  return (
    <>
      <PageHeader
        title="Email"
        sub="Not a sending channel yet. This page drafts a message and hands it to your own mail client — nothing here queues, sends or tracks anything."
        actions={
          <Badge tone="warning">
            <AlertCircle size={12} strokeWidth={2} aria-hidden />
            No provider connected
          </Badge>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads with an email" value={formatNumber(leads.length)} />
        <Stat
          label="Contactable"
          value={formatNumber(contactable.length)}
          sub={optedOut ? `${formatNumber(optedOut)} opted out` : "Nobody has opted out"}
        />
        <Stat label="Hot" value={formatNumber(hot)} sub="Contactable and running hot" gold />
        <Stat label="Domains" value={formatNumber(domains)} sub="Distinct email domains on record" />
      </div>

      <Card
        className="mb-5"
        gold
        title="What it would take to send from here"
        hint="Four things, none of which exist in this deployment today."
        actions={<Plug size={15} strokeWidth={1.75} className="text-[var(--color-gold-300)]" aria-hidden />}
      >
        <ol className="grid gap-3 sm:grid-cols-2">
          {PROVIDER_REQUIREMENTS.map((requirement, index) => (
            <li
              key={requirement.title}
              className="rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/50 px-3.5 py-3"
            >
              <p className="flex items-baseline gap-2 text-sm font-medium text-[var(--color-ink)]">
                <span className="text-xs tabular-nums text-[var(--color-gold-300)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {requirement.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{requirement.detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-[var(--color-gold-line)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
          Until all four are in place, a &ldquo;Send&rdquo; button here could only lie. WhatsApp is the
          one channel with a live integration —{" "}
          <Link href="/inbox/whatsapp/communication/whatsapp" className="text-[var(--color-gold-300)] underline underline-offset-2">
            reply there
          </Link>{" "}
          if the message needs to actually arrive.
        </p>
      </Card>

      <Card
        className="mb-5"
        title="Compose"
        hint="Drafts a message and opens it in your mail client. Works with zero credentials, because your mail client already has them."
        actions={<Mail size={15} strokeWidth={1.75} className="text-[var(--color-muted)]" aria-hidden />}
      >
        {leads.length === 0 ? (
          <Empty>
            No lead has an email address on record. WhatsApp leads arrive with a phone number only —
            an email is captured when the buyer volunteers one.
          </Empty>
        ) : (
          <MailtoComposer leads={composerLeads} initialLeadId={preselected} />
        )}
      </Card>

      <Card
        title="Leads with an email"
        hint="Sorted by most recent contact. Opting out blocks every channel, not just WhatsApp."
        actions={<AtSign size={15} strokeWidth={1.75} className="text-[var(--color-muted)]" aria-hidden />}
      >
        {leads.length === 0 ? (
          <Empty>
            <code className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs">villa_leads</code>{" "}
            holds no row with an email address.
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead className="border-b border-[var(--color-line)]">
                <tr>
                  <th className="th">Lead</th>
                  <th className="th">Email</th>
                  <th className="th">Temp</th>
                  <th className="th">Stage</th>
                  <th className="th">Source</th>
                  <th className="th text-right">Last contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {leads.map((lead) => (
                  <EmailRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function EmailRow({ lead }: { lead: EmailLead }) {
  return (
    <tr className="row-hover">
      <td className="td">
        <Link
          href={`/inbox/whatsapp/crm/leads/${lead.id}`}
          className="font-medium text-[var(--color-ink)] hover:text-[var(--color-gold-300)]"
        >
          {lead.name?.trim() || "Unnamed"}
        </Link>
        <span className="mt-0.5 block text-[11px] text-[var(--color-muted)]">+{lead.phone}</span>
      </td>
      <td className="td">
        {lead.opted_out ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
            <Ban size={12} strokeWidth={2} aria-hidden />
            {lead.email} · opted out
          </span>
        ) : (
          <Link
            href={`/inbox/whatsapp/communication/email?lead=${lead.id}`}
            className="text-xs text-[var(--color-gold-300)] underline underline-offset-2"
          >
            {lead.email}
          </Link>
        )}
      </td>
      <td className="td">
        <TemperaturePill value={lead.lead_temperature} />
      </td>
      <td className="td text-xs capitalize">{humanise(lead.pipeline_stage)}</td>
      <td className="td text-xs">
        <span className="capitalize">{humanise(lead.source)}</span>
        {lead.campaign && (
          <span className="mt-0.5 block truncate text-[11px] text-[var(--color-faint)]">{lead.campaign}</span>
        )}
      </td>
      <td className="td whitespace-nowrap text-right text-xs text-[var(--color-muted)]">
        {timeAgo(lead.last_contact_at)}
      </td>
    </tr>
  );
}
