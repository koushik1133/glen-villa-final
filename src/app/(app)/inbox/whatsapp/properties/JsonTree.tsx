import type { JsonEntry, JsonNode } from "@/lib/osf/properties";

/**
 * Renders a normalised jsonb tree at arbitrary depth.
 *
 * `amenities`, `specifications`, `sustainability` and `connectivity` are
 * transcribed from each developer's own collateral, so their shape is not
 * uniform and not bounded: one project lists amenities as a flat array, another
 * as categories of arrays, a third as categories of objects each with its own
 * list. Rather than guess at a fixed depth, this walks whatever `toJsonNode`
 * produced and lets the *depth* choose the treatment — heading, sub-label, then
 * inline — so a three-level document still reads as prose instead of as an
 * indented data dump.
 *
 * Nothing is invented on the way through: an absent branch was already dropped
 * by `toJsonNode`, and a leaf renders exactly the value that was stored.
 */

export function JsonTree({ node, depth = 0 }: { node: JsonNode; depth?: number }) {
  if (node.kind === "text") {
    return <p className="text-sm leading-relaxed text-[var(--color-ink)]">{node.value}</p>;
  }

  if (node.kind === "list") {
    // Short labels read best as chips; sentences need to wrap, so they become a
    // bulleted list instead of a row of over-wide pills.
    const prose = node.items.some((item) => item.length > 46);
    if (prose) {
      return (
        <ul className="space-y-1.5">
          {node.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-sm leading-relaxed text-[var(--color-ink)]">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-gold-500)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <ul className="flex flex-wrap gap-1.5">
        {node.items.map((item, index) => (
          <li
            key={index}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-void)]/50 px-2.5 py-1 text-xs text-[var(--color-ink)]"
          >
            {item}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={depth === 0 ? "space-y-5" : "space-y-3"}>
      {node.entries.map((entry) => (
        <JsonBranch key={entry.key} entry={entry} depth={depth} />
      ))}
    </div>
  );
}

function JsonBranch({ entry, depth }: { entry: JsonEntry; depth: number }) {
  // A named leaf ("Sahavas" with nothing under it) is a fact in its own right,
  // so it survives as a row rather than being dropped for having no children.
  if (!entry.node) {
    return <p className="text-sm text-[var(--color-ink)]">{entry.label}</p>;
  }

  // A single scalar reads better as "Label — value" on one line than as a
  // heading with a one-word paragraph beneath it.
  if (entry.node.kind === "text") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-line)] pb-2 last:border-0 last:pb-0">
        <span className="label shrink-0">{entry.label}</span>
        <span className="text-sm text-[var(--color-ink)]">{entry.node.value}</span>
      </div>
    );
  }

  if (depth === 0) {
    return (
      <section>
        <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-gold-300)]">
          <span aria-hidden className="h-px w-4 bg-[var(--color-gold-line)]" />
          {entry.label}
        </h3>
        <JsonTree node={entry.node} depth={depth + 1} />
      </section>
    );
  }

  return (
    <div className="border-l border-[var(--color-line)] pl-3.5">
      <p className="label mb-1.5">{entry.label}</p>
      <JsonTree node={entry.node} depth={depth + 1} />
    </div>
  );
}
