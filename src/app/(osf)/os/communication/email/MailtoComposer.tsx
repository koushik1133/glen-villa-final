"use client";

import { useMemo, useState } from "react";
import { Ban, ExternalLink, Mail } from "lucide-react";

/**
 * A composer that produces a `mailto:` link and nothing else.
 *
 * There is no email provider wired into this product, so there is no honest
 * "Send" button to render — a button that queued nothing would be a lie the
 * rest of this console does not tell. What *does* work with zero credentials is
 * handing the drafted message to whatever mail client the rep already has, so
 * that is what this does. The link is built in the browser because the draft
 * changes as it is typed; nothing is posted anywhere.
 */

export interface ComposerLead {
  id: string;
  name: string | null;
  email: string;
  optedOut: boolean;
}

/** Tokens replaced from the selected lead's own record — no invented values. */
function fill(template: string, lead: ComposerLead | undefined): string {
  if (!lead) return template;
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, lead.name?.trim() || "there")
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email);
}

export default function MailtoComposer({
  leads,
  initialLeadId,
}: {
  leads: ComposerLead[];
  initialLeadId?: string;
}) {
  const firstContactable = leads.find((lead) => !lead.optedOut);
  const [leadId, setLeadId] = useState(
    initialLeadId && leads.some((lead) => lead.id === initialLeadId)
      ? initialLeadId
      : (firstContactable?.id ?? ""),
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const lead = useMemo(() => leads.find((entry) => entry.id === leadId), [leads, leadId]);
  const filledSubject = fill(subject, lead);
  const filledBody = fill(body, lead);

  const blocked = !lead || lead.optedOut;
  const href = blocked
    ? undefined
    : `mailto:${lead.email}?subject=${encodeURIComponent(filledSubject)}&body=${encodeURIComponent(filledBody)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="compose-lead">
            To
          </label>
          <select
            id="compose-lead"
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
            className="field mt-1.5"
          >
            {leads.length === 0 && <option value="">No lead has an email address</option>}
            {leads.map((entry) => (
              <option key={entry.id} value={entry.id} disabled={entry.optedOut}>
                {entry.name?.trim() || entry.email}
                {entry.name?.trim() ? ` — ${entry.email}` : ""}
                {entry.optedOut ? " (opted out)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="compose-subject">
            Subject
          </label>
          <input
            id="compose-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Your villa shortlist at Glentree"
            className="field mt-1.5"
          />
        </div>

        <div>
          <label className="label" htmlFor="compose-body">
            Message
          </label>
          <textarea
            id="compose-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={9}
            placeholder={"Hi {{name}},\n\nFollowing up on the 4 BHK you asked about…"}
            className="field mt-1.5 resize-y font-sans leading-relaxed"
          />
          <p className="mt-1.5 text-[11px] text-[--color-faint]">
            <code className="rounded bg-[--color-canvas] px-1 py-0.5">{"{{name}}"}</code> and{" "}
            <code className="rounded bg-[--color-canvas] px-1 py-0.5">{"{{email}}"}</code> are filled
            from this lead&rsquo;s own record before the draft opens.
          </p>
        </div>
      </div>

      <aside className="flex flex-col gap-3 rounded-xl border border-[--color-line] bg-[--color-void]/50 p-4">
        <p className="label">Preview</p>

        {blocked ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-[--color-danger]">
            <Ban size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
            {lead
              ? "This lead opted out. Nothing may be sent to them on any channel, so no draft is offered."
              : "Choose a lead with an email address."}
          </p>
        ) : (
          <>
            <div className="space-y-2 text-xs">
              <p className="text-[--color-muted]">
                <span className="text-[--color-faint]">To </span>
                <span className="text-[--color-ink]">{lead.email}</span>
              </p>
              <p className="text-[--color-muted]">
                <span className="text-[--color-faint]">Subject </span>
                <span className="text-[--color-ink]">
                  {filledSubject || <span className="text-[--color-faint]">(empty)</span>}
                </span>
              </p>
            </div>
            <p className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[--color-line] bg-[--color-canvas] p-3 text-xs leading-relaxed text-[--color-ink]">
              {filledBody || <span className="text-[--color-faint]">Nothing typed yet.</span>}
            </p>
          </>
        )}

        <a
          href={href}
          aria-disabled={blocked}
          className={`btn-gold mt-auto w-full justify-center ${blocked ? "pointer-events-none opacity-40" : ""}`}
        >
          <Mail size={14} strokeWidth={2} aria-hidden />
          Open in mail app
          <ExternalLink size={12} strokeWidth={2} aria-hidden />
        </a>
        <p className="text-[11px] leading-relaxed text-[--color-muted]">
          This hands the draft to your own mail client. VillaOS does not send it, does not log it, and
          cannot tell you whether it was opened.
        </p>
      </aside>
    </div>
  );
}
