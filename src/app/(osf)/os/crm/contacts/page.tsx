import Link from "next/link";
import { Card, Empty, PageHeader, SetupNotice, Stat, formatNumber, timeAgo } from "@/components/osf/ui";
import { contactDirectory, humanise, type ContactRow } from "@/lib/osf/crm";
import { gatedLoad } from "@/lib/osf/queries";

export const dynamic = "force-dynamic";

const BASE = "/os/crm/contacts";

function TypePill({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`pill border capitalize transition ${
        active
          ? "border-[--color-gold-line] bg-[--color-gold-soft] text-[--color-gold-100]"
          : "border-[--color-line] bg-[--color-surface] text-[--color-muted] hover:border-[--color-line-strong] hover:text-[--color-ink]"
      }`}
    >
      {label}
      <span className="tabular-nums text-[--color-faint]">{formatNumber(count)}</span>
    </Link>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  // The whole directory is loaded either way — the filter is applied in memory
  // so the type counts stay accurate while a filter is on.
  const page = await gatedLoad({ table: "villa_contacts", migration: "001_schema.sql" }, () =>
    contactDirectory(),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Contacts" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const { contacts: all, types } = page.data;
  const activeType = types.some((t) => t.type === type) ? type : undefined;
  const contacts = activeType ? all.filter((c) => c.contact_type === activeType) : all;

  const linked = all.filter((contact) => contact.leadCount > 0).length;
  const withEmail = all.filter((contact) => contact.email?.trim()).length;

  return (
    <>
      <PageHeader
        title="Contacts"
        sub="Every phone number the business has ever seen. A contact becomes a lead the moment there is something to sell them — until then it is just a person on record."
      />

      {all.length === 0 ? (
        <Card>
          <Empty>
            <code className="rounded bg-[--color-canvas] px-1.5 py-0.5 text-xs">villa_contacts</code>{" "}
            is empty. A row is written the first time a number reaches the business on any channel.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Contacts" value={formatNumber(all.length)} />
            <Stat
              label="Linked to a lead"
              value={formatNumber(linked)}
              sub={`${formatNumber(all.length - linked)} not yet linked`}
            />
            <Stat label="With an email" value={formatNumber(withEmail)} />
            <Stat label="Contact types" value={formatNumber(types.length)} />
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="label mr-1">Type</span>
            <TypePill href={BASE} active={!activeType} label="All" count={all.length} />
            {types.map((entry) => (
              <TypePill
                key={entry.type}
                href={`${BASE}?type=${encodeURIComponent(entry.type)}`}
                active={activeType === entry.type}
                label={humanise(entry.type)}
                count={entry.count}
              />
            ))}
          </div>

          <Card>
            {contacts.length === 0 ? (
              <Empty
                action={
                  <Link href={BASE} className="btn-ghost">
                    Clear filter
                  </Link>
                }
              >
                No contact of that type.
              </Empty>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[860px]">
                  <thead className="border-b border-[--color-line]">
                    <tr>
                      <th className="th">Contact</th>
                      <th className="th">Type</th>
                      <th className="th">Company</th>
                      <th className="th">Leads</th>
                      <th className="th">First seen</th>
                      <th className="th text-right">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[--color-line]">
                    {contacts.map((contact) => (
                      <ContactRowView key={contact.id} contact={contact} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function ContactRowView({ contact }: { contact: ContactRow }) {
  return (
    <tr className="row-hover">
      <td className="td">
        <span className="font-medium">{contact.name?.trim() || "Unnamed"}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[--color-muted]">
          <span>+{contact.phone}</span>
          {contact.email && <span className="truncate">{contact.email}</span>}
        </span>
        {contact.notes && (
          <span className="mt-1 block max-w-md text-[11px] leading-relaxed text-[--color-faint]">
            {contact.notes}
          </span>
        )}
      </td>
      <td className="td text-xs capitalize">{humanise(contact.contact_type)}</td>
      <td className="td text-xs">{contact.company ?? <span className="text-[--color-faint]">—</span>}</td>
      <td className="td text-xs">
        {contact.leadCount === 0 ? (
          <span className="text-[--color-faint]">None</span>
        ) : contact.leadId ? (
          <Link
            href={`/os/crm/leads/${contact.leadId}`}
            className="text-[--color-gold-300] underline underline-offset-2"
          >
            Open lead
          </Link>
        ) : (
          <span className="tabular-nums">{contact.leadCount} leads</span>
        )}
      </td>
      <td className="td whitespace-nowrap text-xs text-[--color-muted]">{timeAgo(contact.first_seen_at)}</td>
      <td className="td whitespace-nowrap text-right text-xs text-[--color-muted]">
        {timeAgo(contact.last_seen_at)}
      </td>
    </tr>
  );
}
