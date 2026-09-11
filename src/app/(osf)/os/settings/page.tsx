import Link from "next/link";
import { AlertCircle, Plug, Save, Shield } from "lucide-react";
import { Card, PageHeader, SetupNotice, formatDate } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { loadTenant, logoIsSameOrigin } from "@/lib/osf/settings";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

/** Common IANA zones for an Indian developer with NRI buyers. The field is free text. */
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const page = await gatedLoad({ table: "villa_tenant", migration: "001_schema.sql" }, loadTenant);

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Settings" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const tenant = page.data;

  return (
    <>
      <PageHeader
        title="Settings"
        sub={
          tenant
            ? `Organisation details, last saved ${formatDate(tenant.updated_at)}. These appear in the content studio's mockups and on exported reports.`
            : "No organisation record exists yet. Fill this in and save to create it."
        }
      />

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-[rgba(244,105,95,0.3)] bg-[rgba(244,105,95,0.08)] px-4 py-3 text-sm text-[--color-danger]">
          <AlertCircle size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Organisation"
          hint="One record, one row. Saving for the first time creates it."
          className="xl:col-span-2"
        >
          <form action="/api/osf/settings" method="POST" className="space-y-4">
            <input type="hidden" name="action" value="tenant" />
            <input type="hidden" name="next" value="/os/settings" />

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Organisation name" hint="Shown as the sender in every studio mockup.">
                <input
                  name="orgName"
                  required
                  maxLength={120}
                  defaultValue={tenant?.org_name ?? ""}
                  className="field"
                  placeholder="Glentree Homes"
                />
              </Labelled>

              <Labelled label="Legal entity" hint="The name on agreements and receipts.">
                <input
                  name="legalEntity"
                  maxLength={160}
                  defaultValue={tenant?.legal_entity ?? ""}
                  className="field"
                  placeholder="Glentree Developers Pvt Ltd"
                />
              </Labelled>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Primary phone">
                <input
                  name="primaryPhone"
                  maxLength={32}
                  defaultValue={tenant?.primary_phone ?? ""}
                  className="field"
                  placeholder="+91 90000 00000"
                />
              </Labelled>

              <Labelled label="Primary email">
                <input
                  name="primaryEmail"
                  type="email"
                  defaultValue={tenant?.primary_email ?? ""}
                  className="field"
                  placeholder="sales@example.com"
                />
              </Labelled>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Website" hint="Becomes the display URL in the Google and Meta ad previews.">
                <input
                  name="website"
                  type="url"
                  defaultValue={tenant?.website ?? ""}
                  className="field"
                  placeholder="https://example.com"
                />
              </Labelled>

              <Labelled
                label="Logo"
                hint="A path like /logo.png draws in the studio mockups; a remote https URL is stored but not drawn — see below."
              >
                <input
                  name="logoUrl"
                  defaultValue={tenant?.logo_url ?? ""}
                  className="field"
                  placeholder="/logo.png"
                />
                {tenant?.logo_url && !logoIsSameOrigin(tenant.logo_url) && (
                  <span className="mt-1.5 block text-[11px] leading-relaxed text-[--color-warm]">
                    Stored, but not rendered in this console — it is on another origin.
                  </span>
                )}
              </Labelled>
            </div>

            <Labelled label="Address">
              <textarea
                name="address"
                rows={2}
                maxLength={500}
                defaultValue={tenant?.address ?? ""}
                className="field resize-y"
              />
            </Labelled>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Currency" hint="Three-letter code. Display metadata only — see the note.">
                <input
                  name="currency"
                  maxLength={3}
                  defaultValue={tenant?.currency ?? "INR"}
                  className="field uppercase"
                  placeholder="INR"
                />
              </Labelled>

              <Labelled label="Timezone">
                <input
                  name="timezone"
                  list="timezones"
                  defaultValue={tenant?.timezone ?? "Asia/Kolkata"}
                  className="field"
                />
                <datalist id="timezones">
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </Labelled>
            </div>

            <button type="submit" className="btn-gold">
              <Save size={14} strokeWidth={2} aria-hidden />
              {tenant ? "Save changes" : "Create organisation record"}
            </button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card title="Where these values surface">
            <ul className="space-y-2.5 text-sm leading-relaxed text-[--color-muted]">
              <li>
                <span className="text-[--color-ink]">Name</span> renders as the account handle in every
                device mockup in the content studio, and its first letter is the fallback avatar.
              </li>
              <li>
                <span className="text-[--color-ink]">Logo</span> draws as that avatar only when it is
                served from this app. The console&apos;s Content-Security-Policy allows images from{" "}
                <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">&apos;self&apos;</code> only, so a
                logo on another domain would be blocked by the browser and show as a broken image. Put the
                file in <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">public/</code> and
                enter its path.
              </li>
              <li>
                <span className="text-[--color-ink]">Website</span> becomes the display URL on the Google
                SERP preview and the Meta ad&apos;s link bar. Left blank, those frames say so rather than
                showing a placeholder domain.
              </li>
              <li>
                <span className="text-[--color-ink]">Legal entity and address</span> are stored for
                agreements and are not yet printed on anything this console generates.
              </li>
            </ul>
          </Card>

          <Card gold title="About the currency field">
            <p className="text-sm leading-relaxed text-[--color-muted]">
              Every money value in this console is stored as an integer number of rupees and rendered in
              ₹ / lakh / crore by shared formatters. Changing this code records a preference; it does not
              convert a single figure or change how any number is displayed. Multi-currency would mean an
              exchange-rate source and a per-row currency column, neither of which exists.
            </p>
          </Card>

          <Card title="More settings">
            <div className="space-y-2">
              <Link
                href="/os/settings/team"
                className="flex items-center gap-3 rounded-xl border border-[--color-line] bg-[--color-void]/40 px-4 py-3 transition hover:border-[--color-line-strong]"
              >
                <Shield size={15} strokeWidth={1.75} aria-hidden className="text-[--color-gold-500]" />
                <span>
                  <span className="block text-sm font-medium text-[--color-ink]">Team &amp; roles</span>
                  <span className="block text-xs text-[--color-muted]">Roster and the permission matrix</span>
                </span>
              </Link>
              <Link
                href="/os/settings/integrations"
                className="flex items-center gap-3 rounded-xl border border-[--color-line] bg-[--color-void]/40 px-4 py-3 transition hover:border-[--color-line-strong]"
              >
                <Plug size={15} strokeWidth={1.75} aria-hidden className="text-[--color-gold-500]" />
                <span>
                  <span className="block text-sm font-medium text-[--color-ink]">Integrations</span>
                  <span className="block text-xs text-[--color-muted]">
                    What is actually connected, read from the environment
                  </span>
                </span>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
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
      {hint && <span className="mt-0.5 block text-[11px] leading-tight text-[--color-faint]">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
