"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { NAV_ITEMS, type FlatNavItem } from "./nav-config";

/**
 * Navigation search over nav-config, and deliberately nothing more.
 *
 * It does not search leads, bookings or villas: no endpoint exposes that, and
 * a palette that returned plausible-looking record names it had invented would
 * be worse than no palette at all.
 */

/**
 * Subsequence match, scored so the ranking is defensible.
 *
 * Plain `includes()` fails "leadint" → "Lead Intelligence", which is exactly
 * how people type into a palette. Contiguity and word-boundary hits are
 * rewarded so "si" ranks "Site Visits" above "Insights".
 */
function fuzzyScore(query: string, text: string): number | null {
  const haystack = text.toLowerCase();
  let score = 0;
  let cursor = 0;
  let streak = 0;

  for (const char of query) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;

    const atWordStart = found === 0 || /[\s\-/&]/.test(haystack[found - 1]);
    if (atWordStart) score += 12;
    if (found === cursor && cursor > 0) {
      streak += 1;
      score += 6 + streak * 2;
    } else {
      streak = 0;
    }
    // Later matches are weaker, but never negative — a tail match still counts.
    score += Math.max(0, 8 - found);
    cursor = found + 1;
  }

  // Prefer the tighter match when two labels both contain the query.
  return score + Math.max(0, 24 - haystack.length);
}

function rank(query: string): FlatNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return NAV_ITEMS;

  const scored: { item: FlatNavItem; score: number }[] = [];
  for (const item of NAV_ITEMS) {
    const label = fuzzyScore(q, item.label);
    const group = fuzzyScore(q, item.group);
    const combined = fuzzyScore(q, `${item.group} ${item.label}`);
    const keyword =
      item.keywords?.reduce<number | null>((best, k) => {
        const s = fuzzyScore(q, k);
        return s === null ? best : best === null ? s : Math.max(best, s);
      }, null) ?? null;

    // A hit on the visible label outranks one on the group or a hidden keyword,
    // so typing "sales" surfaces the Sales pages before every AI page.
    const best = Math.max(
      label === null ? -Infinity : label + 40,
      group === null ? -Infinity : group + 16,
      combined === null ? -Infinity : combined,
      keyword === null ? -Infinity : keyword,
    );
    if (best > -Infinity) scored.push({ item, score: best });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => rank(query), [query]);
  const activeIndex = results.length === 0 ? -1 : Math.min(index, results.length - 1);

  // Reset per opening, not per keystroke: a stale query from last time reads as
  // a broken palette.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  // Restoring focus is what makes ⌘K → Escape leave the page exactly as found.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setIndex((i) => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) + 1) % results.length));
      return;
    }

    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setIndex((i) =>
        results.length === 0 ? 0 : (Math.min(i, results.length - 1) - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setIndex(Math.max(0, results.length - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) go(target.href);
      return;
    }

    // Tab must not reach the page behind the backdrop, which is still in the
    // document and fully tabbable.
    if (event.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search navigation"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[--color-line-strong] bg-[--color-surface] shadow-[0_40px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-center gap-3 border-b border-[--color-line] px-4">
          <Search size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-[--color-faint]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            role="combobox"
            aria-expanded
            aria-controls="command-palette-results"
            aria-activedescendant={activeIndex >= 0 ? `command-item-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search pages…"
            className="w-full bg-transparent py-4 text-[15px] text-[--color-ink] placeholder:text-[--color-faint] focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-[--color-line] px-1.5 py-0.5 text-[10px] font-medium text-[--color-faint] sm:block">
            ESC
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[--color-muted]">
            No page matches “{query.trim()}”.
          </p>
        ) : (
          <ul
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            className="max-h-[52vh] overflow-y-auto p-1.5"
          >
            {results.map((item, i) => {
              const Icon = item.icon;
              const selected = i === activeIndex;
              return (
                <li key={item.href} id={`command-item-${i}`} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(item.href)}
                    onMouseMove={() => setIndex(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      selected ? "bg-[--color-gold-soft]" : ""
                    }`}
                  >
                    <Icon
                      size={15}
                      strokeWidth={1.75}
                      aria-hidden
                      className={`shrink-0 ${selected ? "text-[--color-gold-300]" : "text-[--color-faint]"}`}
                    />
                    <span
                      className={`flex-1 truncate text-[13px] ${
                        selected ? "text-[--color-gold-100]" : "text-[--color-ink]"
                      }`}
                    >
                      {item.label}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--color-faint]">
                      {item.group}
                    </span>
                    {selected && (
                      <CornerDownLeft
                        size={13}
                        strokeWidth={2}
                        aria-hidden
                        className="shrink-0 text-[--color-gold-500]"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-4 border-t border-[--color-line] px-4 py-2.5 text-[10px] text-[--color-faint]">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-[--color-line] px-1 py-0.5">↑</kbd>
            <kbd className="rounded border border-[--color-line] px-1 py-0.5">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-[--color-line] px-1 py-0.5">↵</kbd>
            open
          </span>
          <span className="ml-auto tabular-nums">
            {results.length} {results.length === 1 ? "page" : "pages"}
          </span>
        </div>
      </div>
    </div>
  );
}
