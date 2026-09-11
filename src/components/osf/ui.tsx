import type { ReactNode } from "react";

/**
 * Shared UI primitives. Every page composes these rather than restyling from
 * scratch, so a palette change lands everywhere at once.
 */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-[family-name:--font-display] text-[28px] leading-tight tracking-tight text-[--color-ink]">
          {title}
        </h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm text-[--color-muted]">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  hint,
  actions,
  gold,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  gold?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${gold ? "card-gold" : ""} ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-[--color-ink]">{title}</h2>}
            {hint && <p className="mt-1 text-xs leading-relaxed text-[--color-muted]">{hint}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  delta,
  gold,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  /** Percentage change vs the previous period. Sign drives the colour. */
  delta?: number | null;
  gold?: boolean;
}) {
  return (
    <div className={`card ${gold ? "card-gold" : ""}`}>
      <p className="label">{label}</p>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className={`stat ${gold ? "text-[--color-gold-300]" : ""}`}>{value}</span>
        {delta !== undefined && delta !== null && (
          <span
            className={`text-xs font-semibold tabular-nums ${
              delta >= 0 ? "text-[--color-success]" : "text-[--color-danger]"
            }`}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      {sub && <p className="mt-1.5 text-xs text-[--color-muted]">{sub}</p>}
    </div>
  );
}

const TEMP_STYLES: Record<string, string> = {
  hot: "bg-[rgba(255,122,92,0.14)] text-[--color-hot]",
  warm: "bg-[rgba(239,180,92,0.14)] text-[--color-warm]",
  cold: "bg-[rgba(125,139,161,0.14)] text-[--color-cold]",
};

export function TemperaturePill({ value }: { value: string }) {
  return (
    <span className={`pill ${TEMP_STYLES[value] ?? TEMP_STYLES.cold}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value.toUpperCase()}
    </span>
  );
}

const TONE_STYLES = {
  neutral: "bg-[--color-raised] text-[--color-muted]",
  gold: "bg-[--color-gold-soft] text-[--color-gold-300]",
  success: "bg-[rgba(94,201,141,0.14)] text-[--color-success]",
  warning: "bg-[rgba(239,180,92,0.14)] text-[--color-warm]",
  danger: "bg-[rgba(244,105,95,0.14)] text-[--color-danger]",
  info: "bg-[rgba(109,168,232,0.14)] text-[--color-info]",
} as const;

export type BadgeTone = keyof typeof TONE_STYLES;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`pill ${TONE_STYLES[tone]}`}>{children}</span>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[--color-line] px-6 py-12 text-center">
      <p className="text-sm text-[--color-muted]">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Shown when credentials are missing or a migration hasn't been run. */
export function SetupNotice({ missing, detail }: { missing: string[]; detail?: string }) {
  if (missing.length === 0 && !detail) return null;
  return (
    <div className="mb-6 rounded-2xl border border-[--color-gold-line] bg-[--color-gold-soft] p-5">
      <h2 className="text-sm font-semibold text-[--color-gold-300]">Setup needed</h2>
      {missing.length > 0 && (
        <>
          <p className="mt-1.5 text-sm text-[--color-ink]">
            Open <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">.env.local</code> and set:
          </p>
          <ul className="mt-2 space-y-1">
            {missing.map((m) => (
              <li key={m}>
                <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-[--color-gold-100]">
                  {m}
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
      {detail && (
        <p className={`text-sm text-[--color-muted] ${missing.length > 0 ? "mt-3" : "mt-1.5"}`}>
          {detail}
        </p>
      )}
    </div>
  );
}

/** Horizontal meter used for share-of-total breakdowns. */
export function Meter({ value, max, tone = "gold" }: { value: number; max: number; tone?: "gold" | "info" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[--color-line]">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          background:
            tone === "gold"
              ? "linear-gradient(90deg, var(--color-gold-600), var(--color-gold-300))"
              : "var(--color-info)",
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------------

/** Rupees → crore. The unit Indian real estate actually quotes in. */
export function formatCr(inr: number | null | undefined): string {
  if (inr === null || inr === undefined) return "—";
  return `₹${(inr / 10000000).toFixed(2)} Cr`;
}

/** Compact rupees: ₹1.2 Cr, ₹45.0 L, ₹8,500. */
export function formatInr(inr: number | null | undefined): string {
  if (inr === null || inr === undefined) return "—";
  if (Math.abs(inr) >= 10000000) return `₹${(inr / 10000000).toFixed(2)} Cr`;
  if (Math.abs(inr) >= 100000) return `₹${(inr / 100000).toFixed(1)} L`;
  return `₹${inr.toLocaleString("en-IN")}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN");
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
