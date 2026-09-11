"use client";

import { useRef, useState } from "react";
import { ArrowUp, ChevronDown, Database, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { formatCr, formatNumber, timeAgo } from "@/components/osf/ui";
import type { CopilotContext } from "@/lib/osf/ai/copilot";

/**
 * The chat surface.
 *
 * Client-side because a conversation genuinely is one — a form POST would
 * throw away the thread on every question. Everything it knows arrives from
 * the route handler: this component never reaches the database, and the
 * context it renders is the exact object the model was given, not a
 * re-derivation of it.
 */

interface Answer {
  id: number;
  question: string;
  answer: string;
  provider: string;
  model: string;
  context: CopilotContext;
  askedAt: string;
}

interface CopilotResponse {
  answer?: string;
  provider?: string;
  model?: string;
  context?: CopilotContext;
  error?: string;
}

export default function Copilot({
  starters,
  initialContext,
}: {
  starters: string[];
  initialContext: CopilotContext;
}) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setQuestion("");

    try {
      const response = await fetch("/api/osf/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as CopilotResponse;

      if (!response.ok || !payload.answer || !payload.context) {
        setError(payload.error ?? `The request failed (${response.status}).`);
        setQuestion(trimmed);
        return;
      }

      setAnswers((prev) => [
        {
          id: Date.now(),
          question: trimmed,
          answer: payload.answer!,
          provider: payload.provider ?? "unknown",
          model: payload.model ?? "unknown",
          context: payload.context!,
          askedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setQuestion(trimmed);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — the convention
                // every messaging surface in this product already uses.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              rows={2}
              maxLength={500}
              placeholder="Ask about leads, sources, revenue, follow-ups, objections, campaigns or inventory…"
              className="field min-h-[64px] resize-none"
              disabled={busy}
            />
            <button
              type="submit"
              className="btn-gold h-[46px] shrink-0 px-4"
              disabled={busy || question.trim() === ""}
              aria-label="Ask"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {starters.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void ask(s)}
                className="rounded-full border border-[--color-line] bg-[--color-void]/50 px-3 py-1.5 text-[11px] text-[--color-muted] transition hover:border-[--color-gold-line] hover:text-[--color-gold-100] disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </form>

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[rgba(244,105,95,0.35)] bg-[rgba(244,105,95,0.08)] p-4 text-sm text-[--color-ink]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[--color-danger]" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {answers.length === 0 && !busy && (
          <div className="rounded-xl border border-dashed border-[--color-line] px-6 py-12 text-center">
            <Sparkles className="mx-auto h-5 w-5 text-[--color-gold-500]" aria-hidden />
            <p className="mt-3 text-sm font-medium text-[--color-ink]">Nothing asked yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[--color-muted]">
              Answers are drawn only from the aggregates in the panel beside this one. If a number
              is not in there, the answer will say so rather than estimate it.
            </p>
          </div>
        )}

        {answers.map((a) => (
          <article key={a.id} className="card">
            <p className="text-sm font-medium text-[--color-gold-100]">{a.question}</p>
            <div className="mt-3 whitespace-pre-wrap border-l-2 border-[--color-gold-line] pl-4 text-sm leading-relaxed text-[--color-ink]">
              {a.answer}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[--color-line] pt-3 text-[11px] text-[--color-faint]">
              <span>
                {a.provider} · {a.model}
              </span>
              <span>·</span>
              <span>{timeAgo(a.askedAt)}</span>
              <span>·</span>
              <span>context read {timeAgo(a.context.generated_at)}</span>
            </div>
            <ContextDisclosure context={a.context} label="Context this answer was given" />
          </article>
        ))}
      </div>

      <aside className="min-w-0">
        <section className="card xl:sticky xl:top-6">
          <header className="mb-3 flex items-start gap-2.5">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-[--color-gold-500]" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-[--color-ink]">What the copilot can see</h2>
              <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">
                A fixed set of aggregates, re-read on every question. No query tool, no SQL, no
                access to individual conversations.
              </p>
            </div>
          </header>
          <ContextSummary context={initialContext} />
          <ContextDisclosure context={initialContext} label="Read the full context" />
        </section>
      </aside>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Context rendering
// -----------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-[--color-muted]">{label}</dt>
      <dd className="text-xs font-semibold tabular-nums text-[--color-ink]">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[--color-line] py-2 first:border-t-0 first:pt-0">
      <p className="label mb-1">{title}</p>
      <dl>{children}</dl>
    </div>
  );
}

function ContextSummary({ context }: { context: CopilotContext }) {
  const f = context.funnel;
  return (
    <div className="text-sm">
      {f && (
        <Section title="Filter">
          <Row label="Leads" value={formatNumber(f.leads)} />
          <Row label="Qualified (score ≥ 50)" value={formatNumber(f.qualified_leads)} />
          <Row label="Hot / warm / cold" value={`${f.hot_leads} / ${f.warm_leads} / ${f.cold_leads}`} />
          <Row
            label="Site visits req. / done"
            value={`${f.site_visits_requested} / ${f.site_visits_completed}`}
          />
          <Row label="Bookings" value={formatNumber(f.bookings)} />
        </Section>
      )}

      {context.revenue && (
        <Section title="Revenue">
          <Row label="Booked value" value={formatCr(context.revenue.total_booked_value_inr)} />
          <Row label="Collected" value={formatCr(context.revenue.total_collected_inr)} />
          <Row label="Months of history" value={formatNumber(context.revenue.recent_months.length)} />
        </Section>
      )}

      {context.follow_ups && (
        <Section title="Follow-ups">
          <Row label="Pending" value={formatNumber(context.follow_ups.pending)} />
          <Row label="Overdue" value={formatNumber(context.follow_ups.overdue)} />
        </Section>
      )}

      <Section title="Lists supplied">
        <Row label="Pipeline stages with leads" value={formatNumber(context.pipeline_by_stage.length)} />
        <Row label="Lead sources" value={formatNumber(context.top_sources.length)} />
        <Row
          label="Hot leads needing attention"
          value={formatNumber(context.hot_leads_needing_attention.length)}
        />
        <Row label="Objection categories" value={formatNumber(context.objections.length)} />
        <Row label="Campaigns" value={formatNumber(context.campaigns.length)} />
        <Row label="Villa types in inventory" value={formatNumber(context.inventory.length)} />
      </Section>

      {context.unavailable.length > 0 && (
        <div className="mt-2 rounded-lg border border-[--color-gold-line] bg-[--color-gold-soft] p-3">
          <p className="text-[11px] font-semibold text-[--color-gold-300]">
            Not readable right now — treated as missing, never as zero
          </p>
          <ul className="mt-1 space-y-0.5">
            {context.unavailable.map((u) => (
              <li key={u} className="text-[11px] text-[--color-muted]">
                {u}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The raw context, collapsed.
 *
 * Rendering the literal JSON matters more than prettifying it: the claim this
 * page makes is that every figure in an answer came from here, and that is
 * only checkable against the exact object the model received.
 */
function ContextDisclosure({ context, label }: { context: CopilotContext; label: string }) {
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-[--color-muted] transition hover:text-[--color-gold-100]">
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
          aria-hidden
        />
        {label}
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-[--color-line] bg-[--color-void] p-3 font-mono text-[10px] leading-relaxed text-[--color-muted]">
        {JSON.stringify(context, null, 2)}
      </pre>
    </details>
  );
}
