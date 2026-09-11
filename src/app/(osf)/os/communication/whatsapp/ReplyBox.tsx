"use client";

import { useEffect, useState } from "react";
import { Clock, FileText, Lock, Send } from "lucide-react";

/**
 * The WhatsApp composer.
 *
 * Client-side for one reason that matters: the 24-hour customer-service window
 * expires while the tab is open. A server-rendered composer would happily keep
 * offering a free-text box twenty minutes after Meta stopped accepting one, and
 * the rep would only find out when the send failed. The countdown here is
 * derived from a real timestamp (the customer's last inbound message), and when
 * it hits zero the composer switches itself to template-only.
 */

const MAX_TEXT = 4096;

function formatLeft(ms: number): string {
  if (ms <= 0) return "Window closed";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${minutes}m left`;
}

export default function ReplyBox({
  conversationId,
  windowClosesAt,
  initiallyOpen,
  initialLabel,
  preferredLanguage,
}: {
  conversationId: string;
  /** ISO instant free-text stops being allowed. Null when the customer never wrote. */
  windowClosesAt: string | null;
  initiallyOpen: boolean;
  initialLabel: string;
  preferredLanguage: string;
}) {
  // Null until mounted so the first client render matches the server's.
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<"text" | "template">("text");
  const [text, setText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateParams, setTemplateParams] = useState("");

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const closesAt = windowClosesAt ? new Date(windowClosesAt).getTime() : null;
  const live = now !== null && closesAt !== null;
  const open = live ? now < closesAt : initiallyOpen;
  const label = live ? formatLeft(closesAt - now) : initialLabel;

  const composing = open ? mode : "template";
  const over = text.length > MAX_TEXT;
  const params = templateParams
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);

  const next = `/os/communication/whatsapp?c=${conversationId}`;

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span
          className={`pill ${
            open
              ? "bg-[rgba(94,201,141,0.14)] text-[var(--color-success)]"
              : "bg-[rgba(239,180,92,0.14)] text-[var(--color-warm)]"
          }`}
        >
          {open ? <Clock size={12} strokeWidth={2} aria-hidden /> : <Lock size={12} strokeWidth={2} aria-hidden />}
          24h window · {label}
        </span>

        {open && (
          <div className="flex items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)] p-1">
            {(["text", "template"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  mode === value
                    ? "bg-[var(--color-gold-soft)] text-[var(--color-gold-100)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {value === "text" ? "Free text" : "Template"}
              </button>
            ))}
          </div>
        )}
      </div>

      {!open && (
        <div className="mb-3 rounded-xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-gold-300)]">
            <Lock size={14} strokeWidth={2} aria-hidden />
            Free text is disabled
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink)]">
            Meta only accepts a free-form message within 24 hours of the customer&apos;s last
            inbound one. That window has closed, so the only message the WhatsApp Cloud API will
            deliver to this number is a <strong>pre-approved template</strong>. Sending one
            re-opens the window as soon as the customer replies.
          </p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Templates are created and approved in the Meta Business Manager, not here — this box
            takes the approved template&apos;s name.
          </p>
        </div>
      )}

      {composing === "text" ? (
        <form action="/api/osf/communication" method="POST">
          <input type="hidden" name="action" value="send_text" />
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="next" value={next} />

          <textarea
            name="text"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Reply as a human. This pauses the AI on this lead."
            className="field resize-y"
          />

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-muted)]">
              Sending sets{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-[var(--color-gold-100)]">
                ai_paused
              </code>{" "}
              so the agent stops replying on this thread.
            </p>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs tabular-nums ${
                  over ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"
                }`}
              >
                {text.length.toLocaleString("en-IN")} / {MAX_TEXT.toLocaleString("en-IN")}
              </span>
              <button type="submit" className="btn-gold" disabled={text.trim() === "" || over}>
                <Send size={14} strokeWidth={2} aria-hidden />
                Send
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form action="/api/osf/communication" method="POST" className="space-y-3">
          <input type="hidden" name="action" value="send_template" />
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="next" value={next} />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <label className="block">
              <span className="label">Approved template name</span>
              <input
                name="templateName"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="site_visit_reminder"
                className="field mt-1.5"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="label">Language</span>
              <input
                name="language"
                defaultValue={preferredLanguage}
                placeholder="en"
                className="field mt-1.5"
                autoComplete="off"
              />
            </label>
          </div>

          <label className="block">
            <span className="label">Body variables</span>
            <input
              name="params"
              value={templateParams}
              onChange={(event) => setTemplateParams(event.target.value)}
              placeholder="Ravi | Saturday 11am"
              className="field mt-1.5"
              autoComplete="off"
            />
            <span className="mt-1.5 block text-xs text-[var(--color-muted)]">
              Separate with <code className="rounded bg-black/40 px-1 py-0.5 text-[11px]">|</code>.
              They fill {"{{1}}"}, {"{{2}}"} … in the approved body, in order.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-muted)]">
              {templateName.trim()
                ? `Sends "${templateName.trim().toLowerCase()}" with ${params.length} variable${
                    params.length === 1 ? "" : "s"
                  }.`
                : "The name must match the template exactly as approved in Meta."}
            </p>
            <button type="submit" className="btn-gold" disabled={templateName.trim() === ""}>
              <FileText size={14} strokeWidth={2} aria-hidden />
              Send template
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
