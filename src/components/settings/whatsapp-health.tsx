import { Badge, Card, SectionTitle } from "@/components/ui";
import type { WhatsAppHealth } from "@/lib/platforms/whatsapp-health";
import { operatorId, operatorText } from "@/lib/whitelabel";

/**
 * Admin-only (users.manage) WhatsApp readiness card. The page checks; this draws.
 *
 * Every row names what the setting *does*, never what it is called in the
 * environment, and never prints an id Meta issued us. The vendor's own
 * deployment can still see the number id via `operatorId`.
 */
export function WhatsAppHealthCard({ h }: { h: WhatsAppHealth }) {
  const p = h.phone;
  const numberId = operatorId(h.phoneNumberId);
  const rows: Array<{ label: string; value: string; ok: boolean; hint: string }> = [
    {
      label: "Business number",
      value: !h.phoneNumberId ? "unset" : !h.tokenSet ? "no access" : p?.error ? "error" : p?.displayNumber ?? "resolving",
      ok: Boolean(p?.displayNumber),
      hint: !h.phoneNumberId
        ? "No business number is connected yet"
        : p?.error
          ? operatorText(p.error)
          : p
            ? `${p.verifiedName ?? "no display name"} \u00b7 name ${p.nameStatus ?? "?"}${numberId ? ` \u00b7 id ${numberId}` : ""}`
            : "Messaging access is not set up, so the number cannot be checked",
    },
    {
      label: "Quality rating",
      value: p?.qualityRating ?? "unknown",
      ok: p?.qualityRating === "GREEN",
      hint: "GREEN is healthy; YELLOW/RED lowers the daily messaging limit",
    },
    { label: "Webhook verification", value: h.verifyTokenSet ? "set" : "unset", ok: h.verifyTokenSet, hint: "Message delivery cannot be switched on until this is set up" },
    { label: "Message verification", value: h.appSecretSet ? "set" : "unset", ok: h.appSecretSet, hint: "Incoming messages are rejected until this is set up" },
    { label: "Public address", value: h.publicBaseUrl ? "set" : "unset", ok: Boolean(h.publicBaseUrl), hint: h.publicBaseUrl ? "Incoming messages and media links have somewhere to arrive" : "Needed before messages and media links can reach this console" },
    {
      label: "Last inbound message",
      value: h.lastInboundAt ? new Date(h.lastInboundAt).toLocaleString() : "never",
      ok: Boolean(h.lastInboundAt),
      hint: h.lastInboundAt ? "The webhook has delivered at least once" : "No customer message has reached the webhook yet",
    },
    { label: "AI writer", value: h.aiWriterReady ? "ready" : "not configured", ok: h.aiWriterReady, hint: h.aiWriterReady ? "Replies are drafted by the AI writer" : "Deterministic replies only until an AI writer is connected" },
  ];
  return (
    <Card>
      <SectionTitle title="WhatsApp health" hint="Read-only checks for the business number and webhook (admins only)" />
      <div className="grid gap-2 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 rounded-lg border border-ink-700 p-3">
            <Badge tone={r.ok ? "good" : "warn"}>{r.value}</Badge>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-mist-100">{r.label}</div>
              <div className="break-all text-[11px] text-mist-400">{r.hint}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
