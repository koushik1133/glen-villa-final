import { Card } from "@/components/ui";

/**
 * Streaming placeholders. Same card shell and spacing as the real sections, so
 * the swap when the server section arrives costs no layout shift.
 */
export function CardSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <Card className={className}>
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-40 rounded bg-ink-700/70" />
        <div className="h-2.5 w-64 rounded bg-ink-800" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-ink-800/70" />
        ))}
      </div>
    </Card>
  );
}

/** Full-page fallback used by route-level loading.tsx files. */
export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="space-y-6 p-7">
      <div className="animate-pulse space-y-2">
        <div className="h-4 w-48 rounded bg-ink-700/70" />
        <div className="h-2.5 w-72 rounded bg-ink-800" />
      </div>
      {Array.from({ length: blocks }).map((_, i) => (
        <CardSkeleton key={i} rows={i === 0 ? 4 : 3} />
      ))}
    </div>
  );
}
