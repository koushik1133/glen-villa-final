"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { DEFAULT_RANGE, RANGE_PRESETS, type RangeKey, parseRange } from "./nav-config";

/**
 * Range presets, stored in the URL rather than in React state.
 *
 * Server Components can't read a client store, and every page here is a Server
 * Component — putting the choice in `?range=` is the only way the filter can
 * reach the query that actually needs it, and it makes a filtered view
 * shareable and back-button-able for free.
 */
export default function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = parseRange(searchParams.get("range"));
  const preset = RANGE_PRESETS.find((p) => p.key === current)!;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = useCallback(
    (key: RangeKey) => {
      setOpen(false);
      const params = new URLSearchParams(searchParams.toString());
      // The default is left implicit so the common URL stays clean; every page
      // reads it back through parseRange(), which defaults identically.
      if (key === DEFAULT_RANGE) params.delete("range");
      else params.set("range", key);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-[--color-line] bg-[--color-surface] px-3 py-2 text-[13px] font-medium text-[--color-ink] transition hover:border-[--color-line-strong] hover:bg-[--color-raised]"
      >
        <CalendarRange size={14} strokeWidth={1.75} aria-hidden className="text-[--color-gold-500]" />
        <span className="hidden sm:inline">{preset.label}</span>
        <span className="sm:hidden">{preset.short}</span>
        <ChevronDown
          size={13}
          strokeWidth={2.5}
          aria-hidden
          className={`text-[--color-faint] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Date range"
          className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-[--color-line] bg-[--color-surface] p-1.5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.85)]"
        >
          {RANGE_PRESETS.map((p) => {
            const selected = p.key === current;
            return (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(p.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition ${
                  selected
                    ? "bg-[--color-gold-soft] text-[--color-gold-100]"
                    : "text-[--color-muted] hover:bg-[--color-raised] hover:text-[--color-ink]"
                }`}
              >
                {p.label}
                {selected && <Check size={14} strokeWidth={2.5} aria-hidden className="text-[--color-gold-500]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
