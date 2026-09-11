import { Badge, Card, PageHeader, type BadgeTone } from "@/components/osf/ui";
import { whatsappReadiness, type Check } from "@/lib/osf/whatsapp/readiness";
import { VoiceTester } from "./VoiceTester";

export const dynamic = "force-dynamic";

const TONE: Record<string, BadgeTone> = {
  ok: "success",
  missing: "warning",
  error: "danger",
  checking: "neutral",
};

const LABEL: Record<string, string> = {
  ok: "Ready",
  missing: "Not set",
  error: "Error",
  checking: "…",
};

function CheckRow({ check }: { check: Check }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-[--color-line] py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{check.label}</span>
          {check.blocking && check.state !== "ok" && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[--color-danger]">
              blocks go-live
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">{check.detail}</p>
        {check.fix && check.state !== "ok" && (
          <p className="mt-1 text-xs text-[--color-gold-300]">→ {check.fix}</p>
        )}
      </div>
      <Badge tone={TONE[check.state]}>{LABEL[check.state]}</Badge>
    </li>
  );
}

export default async function WhatsAppPage() {
  const { checks, ready, blockingCount } = await whatsappReadiness();

  return (
    <>
      <PageHeader
        title="WhatsApp"
        sub="Everything the agent needs to answer real customers on WhatsApp — chat and voice notes. Each row is checked live, not read from a saved setting."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          gold={ready}
          title={ready ? "Ready to go live" : `${blockingCount} thing${blockingCount === 1 ? "" : "s"} left`}
          hint={
            ready
              ? "Point the Meta webhook at your deployed /api/osf/whatsapp and messages will start flowing."
              : "Rows marked as blocking must be resolved before real customers can reach the agent."
          }
        >
          <ul>
            {checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card title="Webhook settings" hint="Paste these into Meta → WhatsApp → Configuration.">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="label">Callback URL</dt>
                <dd className="mt-1 break-all rounded-lg bg-[--color-void] px-3 py-2 font-mono text-xs">
                  {(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}
                  /api/osf/whatsapp
                </dd>
              </div>
              <div>
                <dt className="label">Verify token</dt>
                <dd className="mt-1 text-xs text-[--color-muted]">
                  The value of WHATSAPP_VERIFY_TOKEN in your .env.local — type the same string
                  into Meta.
                </dd>
              </div>
              <div>
                <dt className="label">Subscribe to</dt>
                <dd className="mt-1 text-xs text-[--color-muted]">
                  The <code className="text-[--color-gold-300]">messages</code> field. That one
                  covers text, voice notes, images and button replies.
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Testing locally" hint="Meta cannot call localhost.">
            <p className="text-xs leading-relaxed text-[--color-muted]">
              Expose this machine with a tunnel, then use the https URL it prints as the callback:
            </p>
            <code className="mt-2 block rounded-lg bg-[--color-void] px-3 py-2 font-mono text-xs">
              npx ngrok http 3000
            </code>
            <p className="mt-3 text-xs leading-relaxed text-[--color-muted]">
              Set NEXT_PUBLIC_APP_URL to that same https URL, or brochure links the agent sends
              will point at localhost and fail when WhatsApp tries to fetch them.
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <VoiceTester />
      </div>
    </>
  );
}
