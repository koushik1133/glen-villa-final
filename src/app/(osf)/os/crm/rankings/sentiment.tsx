/**
 * Sentiment presentation, shared by the rankings table and the dashboard block.
 *
 * Kept beside the ranking rather than in ui.tsx because sentiment is a property
 * of a conversation, not a general-purpose badge: null means "they have not
 * said anything yet", which is a different statement from "neutral", and both
 * need to survive into the UI without being flattened together.
 */
export const SENTIMENT_TONES: Record<string, string> = {
  positive: "bg-[rgba(94,201,141,0.14)] text-[var(--color-success)]",
  neutral: "bg-[var(--color-raised)] text-[var(--color-muted)]",
  negative: "bg-[rgba(244,105,95,0.14)] text-[var(--color-danger)]",
  unknown: "bg-[var(--color-raised)] text-[var(--color-faint)]",
};

export function SentimentPill({ value }: { value: string | null }) {
  const key = value ?? "unknown";
  const label = value ?? "no reply yet";
  return (
    <span className={`pill ${SENTIMENT_TONES[key] ?? SENTIMENT_TONES.unknown}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
